/**
 * Feed-first discovery for Add Source.
 *
 * The pipeline deliberately finds and validates an existing syndication feed
 * before asking the Web-to-RSS extractor to scrape a page. Many publishers
 * block Worker-origin page requests yet publish a public feed on another host.
 */
import { validateSourceInput } from './source-intake.js';
import { parseXmlFeed } from './rss-parser.js';
import { buildRssFromUrl, buildRssFromItems, formatFeedResponse } from './web-to-rss.js';
import { getOfficialFeedCandidates, getOfficialFeedCollection } from './official-feed-registry.js';

const COMMON_FEED_PATHS = [
  '/feed', '/feed/', '/feed.xml', '/rss', '/rss/', '/rss.xml', '/atom.xml', '/index.xml',
  '/news/feed', '/rss/news', '/feeds/posts/default', '/blog/feed', '/blog/rss.xml',
  '/wp-json/wp/v2/posts?per_page=20', '/?feed=rss2'
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FeedOmeter/2.1; +https://feedometer.pages.dev)',
  'Accept': 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9'
};

function isSyndicationDocument(body) {
  const text = String(body || '').trim();
  return /^\s*(?:<\?xml[^>]*>\s*)?<(?:rss|feed|rdf:RDF)\b/i.test(text);
}

function toItems(parsed) {
  return (parsed.items || []).map((item) => ({
    title: item.title,
    link: item.link,
    // `rss-parser.js` normalizes RSS and Atom as `summary`/`published`.
    // Preserve those fields so collection feeds retain their real description
    // and publisher date instead of receiving a synthetic timestamp.
    description: item.snippet || item.description || item.summary || item.content || '',
    pubDate: item.pubDate || item.published || item.updated || new Date().toUTCString(),
    image: item.image || ''
  }));
}

function absoluteUrl(href, baseUrl) {
  try { return new URL(href, baseUrl).toString(); } catch (_) { return ''; }
}

function alternateFeedUrls(html, baseUrl) {
  const matches = String(html || '').matchAll(/<link\b[^>]*>/gi);
  const urls = [];
  for (const match of matches) {
    const tag = match[0];
    if (!/\brel=["']?alternate(?:["'\s>])/i.test(tag)) continue;
    if (!/\btype=["']?(?:application\/(?:rss\+xml|atom\+xml|feed\+json)|text\/xml)/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const resolved = href && absoluteUrl(href, baseUrl);
    if (resolved) urls.push(resolved);
  }
  return [...new Set(urls)];
}

async function fetchWithLimit(url, fetchFn) {
  const response = await fetchFn(url, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(7000)
  });
  const body = await response.text();
  return { response, body, finalUrl: response.url || url };
}

async function validateFeedCandidate(candidate, siteUrl, fetchFn) {
  try {
    const fetched = await fetchWithLimit(candidate.url, fetchFn);
    if (!fetched.response.ok || !isSyndicationDocument(fetched.body)) return null;
    const parsed = parseXmlFeed(fetched.body);
    const items = toItems(parsed);
    if (!items.length) return null;
    return formatFeedResponse({
      xml: fetched.body,
      siteUrl,
      feedUrl: fetched.finalUrl,
      meta: {
        title: parsed.title || candidate.label || new URL(siteUrl).hostname,
        description: parsed.description || `Official feed for ${new URL(siteUrl).hostname}`,
        image: ''
      },
      items
    });
  } catch (_) {
    return null;
  }
}

function normalizedArticleKey(item) {
  try {
    const url = new URL(item.link);
    url.hash = '';
    return url.toString();
  } catch (_) {
    return `${item.title || ''}|${item.pubDate || ''}`;
  }
}

function articleTimestamp(item) {
  const timestamp = Date.parse(item.pubDate || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Combines only publisher-owned feeds. This is not page scraping: each source
 * remains an official feed, then duplicate stories are removed by canonical URL.
 */
async function buildOfficialCollection(collection, siteUrl, fetchFn) {
  const results = await Promise.all(
    collection.feeds.map((candidate) => validateFeedCandidate(candidate, siteUrl, fetchFn))
  );
  const byArticle = new Map();
  for (const result of results) {
    for (const item of result?.items || []) {
      const key = normalizedArticleKey(item);
      if (key && !byArticle.has(key)) byArticle.set(key, item);
    }
  }
  const items = [...byArticle.values()]
    .sort((a, b) => articleTimestamp(b) - articleTimestamp(a))
    .slice(0, collection.maxItems || 60);
  if (!items.length) return null;

  const meta = { title: collection.title, description: collection.description, image: '' };
  return formatFeedResponse({
    xml: buildRssFromItems(siteUrl, meta.title, meta.description, items),
    siteUrl,
    feedUrl: siteUrl,
    meta,
    items
  });
}

async function lookupVerifiedSourceCandidates(env, targetUrl) {
  if (!env?.DB) return [];
  let host = '';
  try { host = new URL(targetUrl).hostname.replace(/^www\./i, '').toLowerCase(); } catch (_) { return []; }
  try {
    const rows = await env.DB.prepare(`
      SELECT title, feed_url, website_url, is_verified
      FROM sources
      WHERE is_verified = 1
        AND (LOWER(COALESCE(website_url, '')) LIKE ? OR LOWER(COALESCE(publisher_domain, '')) = ?)
      ORDER BY is_verified DESC, article_count DESC
      LIMIT 8
    `).bind(`%${host}%`, host).all();
    return (rows.results || []).filter((row) => row.feed_url).map((row) => ({
      label: row.title || 'Verified feed', url: row.feed_url, source: 'd1_registry'
    }));
  } catch (_) {
    // The registry is an enhancement; a D1 catalog query must never block discovery.
    return [];
  }
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = String(candidate.url || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function discoveryError(status) {
  const error = new Error(status === 403 || status === 429
    ? 'This website blocks automated access. Try its official RSS/Atom URL or search the feed directory.'
    : 'We could not discover a public feed for this website.');
  error.recovery = {
    type: status === 403 || status === 429 ? 'site_access_restricted' : 'feed_not_found',
    httpStatus: status || null,
    suggestions: ['Paste an RSS/Atom URL', 'Search FeedOmeter’s directory', 'Try Visual Builder for accessible pages']
  };
  return error;
}

/**
 * Keeps the legacy `buildRssFromUrl` extractor as the final fallback. The API
 * response remains unchanged; `discovery` is additive diagnostic metadata.
 */
export async function discoverFeedFromUrl(rawUrl, env = null, { fetchFn = fetch, extractor = buildRssFromUrl } = {}) {
  const validation = validateSourceInput(rawUrl, { allowKeywords: true });
  if (!validation.ok) throw new Error(validation.message);
  if (validation.detected?.type !== 'website' && validation.detected?.type !== 'rss_atom') {
    return extractor(rawUrl, env);
  }

  const targetUrl = validation.normalized;
  const officialCollection = getOfficialFeedCollection(targetUrl);
  if (officialCollection) {
    const result = await buildOfficialCollection(officialCollection, targetUrl, fetchFn);
    if (result) {
      return {
        ...result,
        discovery: {
          method: 'official_collection',
          feeds: officialCollection.feeds.map((feed) => feed.url)
        }
      };
    }
  }

  const candidates = uniqueCandidates([
    ...getOfficialFeedCandidates(targetUrl),
    ...await lookupVerifiedSourceCandidates(env, targetUrl)
  ]);
  for (const candidate of candidates) {
    const result = await validateFeedCandidate(candidate, targetUrl, fetchFn);
    if (result) return { ...result, discovery: { method: candidate.source, candidate: candidate.url } };
  }

  let page = null;
  try {
    page = await fetchWithLimit(targetUrl, fetchFn);
    if (page.response.ok && isSyndicationDocument(page.body)) {
      const direct = await validateFeedCandidate({ label: 'Direct feed', url: targetUrl }, targetUrl, fetchFn);
      if (direct) return { ...direct, discovery: { method: 'direct_feed', candidate: targetUrl } };
    }
    if (page.response.ok) {
      const alternates = alternateFeedUrls(page.body, page.finalUrl).map((url) => ({ label: 'Discovered feed', url, source: 'html_alternate' }));
      for (const candidate of uniqueCandidates(alternates)) {
        const result = await validateFeedCandidate(candidate, targetUrl, fetchFn);
        if (result) return { ...result, discovery: { method: candidate.source, candidate: candidate.url } };
      }
    }
  } catch (_) {}

  let origin = '';
  try { origin = new URL(targetUrl).origin; } catch (_) {}
  const probes = COMMON_FEED_PATHS.map((path) => ({ label: 'Common feed path', url: origin + path, source: 'common_path' }));
  for (const candidate of uniqueCandidates(probes)) {
    const result = await validateFeedCandidate(candidate, targetUrl, fetchFn);
    if (result) return { ...result, discovery: { method: candidate.source, candidate: candidate.url } };
  }

  try {
    const extracted = await extractor(rawUrl, env);
    return { ...extracted, discovery: { method: 'page_extraction', candidate: targetUrl } };
  } catch (_) {
    throw discoveryError(page?.response?.status);
  }
}
