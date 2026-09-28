/**
 * Preview-only website-to-feed service.
 * It never writes sources, user_feeds, articles, or SQL cache rows. A source
 * is persisted only when the user explicitly follows it through FeedService.
 */
const crypto = require('crypto');
const { isPublicHttpUrl, discoverFeedFromWebsite } = require('../discovery/feedValidator');

const MAX_HTML_BYTES = 512000;
const DEFAULT_LIMIT = 24;
const FIRST_BATCH_SIZE = 20;
const JOB_TTL_MS = 5 * 60 * 1000;
const previewJobs = new Map();

// Directory pages are discovery hints only. Their links are parsed and every
// resulting feed is still fetched/validated before use.
const PUBLISHER_RSS_DIRECTORIES = {
  // Publisher-documented OPML inventory, not an inferred individual feed URL.
  'bbc.com': ['https://news.bbc.co.uk/rss/feeds.opml'],
  'bbc.co.uk': ['https://news.bbc.co.uk/rss/feeds.opml'],
  'news.sky.com': ['https://news.sky.com/info/rss']
};

// Publisher-verified English directory snapshots with provenance
const BLOCKED_DIRECTORY_SNAPSHOTS = {
  'bbc.com': [
    ['Home', 'https://feeds.bbci.co.uk/news/rss.xml'],
    ['UK', 'https://feeds.bbci.co.uk/news/uk/rss.xml'],
    ['World', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
    ['Business', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
    ['Politics', 'https://feeds.bbci.co.uk/news/politics/rss.xml'],
    ['Technology', 'https://feeds.bbci.co.uk/news/technology/rss.xml'],
    ['Science', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'],
    ['Entertainment', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'],
    ['Health', 'https://feeds.bbci.co.uk/news/health/rss.xml'],
    ['Sport', 'https://feeds.bbci.co.uk/sport/rss.xml']
  ].map(([name, url]) => ({ name, url, section: name, provenance: 'publisher_directory_snapshot' })),
  'bbc.co.uk': [
    ['Home', 'https://feeds.bbci.co.uk/news/rss.xml'],
    ['UK', 'https://feeds.bbci.co.uk/news/uk/rss.xml'],
    ['World', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
    ['Business', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
    ['Politics', 'https://feeds.bbci.co.uk/news/politics/rss.xml'],
    ['Technology', 'https://feeds.bbci.co.uk/news/technology/rss.xml'],
    ['Science', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'],
    ['Entertainment', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'],
    ['Health', 'https://feeds.bbci.co.uk/news/health/rss.xml'],
    ['Sport', 'https://feeds.bbci.co.uk/sport/rss.xml']
  ].map(([name, url]) => ({ name, url, section: name, provenance: 'publisher_directory_snapshot' })),
  'news.sky.com': [
    ['Home', 'https://feeds.skynews.com/feeds/rss/home.xml'],
    ['UK', 'https://feeds.skynews.com/feeds/rss/uk.xml'],
    ['World', 'https://feeds.skynews.com/feeds/rss/world.xml'],
    ['US', 'https://feeds.skynews.com/feeds/rss/us.xml'],
    ['Business', 'https://feeds.skynews.com/feeds/rss/business.xml'],
    ['Politics', 'https://feeds.skynews.com/feeds/rss/politics.xml'],
    ['Technology', 'https://feeds.skynews.com/feeds/rss/technology.xml'],
    ['Entertainment', 'https://feeds.skynews.com/feeds/rss/entertainment.xml'],
    ['Strange News', 'https://feeds.skynews.com/feeds/rss/strange.xml']
  ].map(([name, url]) => ({ name, url, section: name, provenance: 'publisher_directory_snapshot' }))
};

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

function decodeHtml(value) { return cleanText(String(value || '').replace(/&nbsp;/gi, ' ')); }

function normalizeImageUrl(raw) {
  let value = String(raw || '').trim()
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '')
    .replace(/&#39;/gi, "'");
  if (value.startsWith('//')) value = `https:${value}`;
  return /^https?:\/\//i.test(value) ? value : '';
}

function isUsableImage(raw) {
  const value = normalizeImageUrl(raw);
  if (!value) return false;
  const lower = value.toLowerCase();
  if (/favicon|sprite|gravatar|doubleclick|scorecardresearch|pixel\.(gif|png|jpe?g)|spacer|tracking|quantserve|beacon/.test(lower)) return false;
  if (/\/(1|2|8|16|24|32)x\1\b/.test(lower)) return false;
  if (/[?&](w|width|h|height)=([1-9]|[12][0-9])\b/.test(lower)) return false;
  return true;
}

function upgradeImageUrl(raw) {
  let value = normalizeImageUrl(raw);
  if (!value || /[?&](s|sig|signature|token|hmac|auth|hash)=/i.test(value)) return value;
  if (!/i\.guim\.co\.uk/i.test(value)) {
    value = value.replace(/ichef\.bbci\.co\.uk\/news\/\d+\//i, 'ichef.bbci.co.uk/news/1024/');
    value = value.replace(/ichef\.bbci\.co\.uk\/ace\/standard\/\d+\//i, 'ichef.bbci.co.uk/ace/standard/1024/');
    value = value.replace(/ichef\.bbci\.co\.uk\/ace\/ws\/\d+\//i, 'ichef.bbci.co.uk/ace/ws/1024/');
    value = value.replace(/ichef\.bbci\.co\.uk\/cpsprodpb\/\d+\//i, 'ichef.bbci.co.uk/cpsprodpb/1024/');
    value = value.replace(/_(\d{2,3}|\d{3}x\d{3})\.(jpg|jpeg|png|webp)/i, '_1024.$2');
    value = value.replace(/([?&])(w|width)=\d+/ig, '$1$2=1200');
    value = value.replace(/([?&])(h|height)=\d+/ig, '$1$2=800');
    value = value.replace(/resize=\d+,\d+/i, 'resize=1200,800');
    value = value.replace(/\/(default|mqdefault|sddefault)\.jpg/i, '/hqdefault.jpg');
    value = value.replace(/-(?:150x150|240x135|300x\d+|400x\d+)\.(jpg|jpeg|png|webp)/i, '.$1');
  }
  return value;
}

function attribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function metaContent(html, names) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (attribute(tag, 'property') || attribute(tag, 'name')).toLowerCase();
    if (names.includes(key)) return decodeHtml(attribute(tag, 'content'));
  }
  return '';
}

function titleFromHtml(html) {
  return metaContent(html, ['og:title', 'twitter:title']) || cleanText((String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
}

async function fetchPage(url, timeoutMs = 8000) {
  if (!isPublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9,*/*;q=0.1',
        'user-agent': 'FeedOmeter Preview/2.1 (+https://feedometer.app)'
      }
    });
    const finalUrl = response.url || url;
    if (!isPublicHttpUrl(finalUrl)) return null;
    const body = (await response.text()).slice(0, MAX_HTML_BYTES);
    return { ok: response.ok, status: response.status, url: finalUrl, contentType: response.headers.get('content-type') || '', body };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isFeedDocument(body) {
  // Do not detect feed-like words anywhere in an HTML document. A candidate is
  // a feed only when its actual document root is RSS, Atom, or RDF/RSS.
  let xml = String(body || '').replace(/^\uFEFF/, '').trimStart();
  xml = xml.replace(/^<\?xml\b[^>]*\?>\s*/i, '').replace(/^(?:<!--([\s\S]*?)-->\s*)+/i, '');
  if (/^(?:<rss\b|<feed\b|<rdf:RDF\b)/i.test(xml)) return true;
  try {
    const value = JSON.parse(xml);
    return /^https:\/\/jsonfeed\.org\/version\//i.test(String(value.version || '')) && Array.isArray(value.items) && value.items.some((item) => item && (item.url || item.external_url) && item.title);
  } catch (_) { return false; }
}

function canonicalArticleUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_[ce]id$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch (_) { return String(rawUrl || '').trim(); }
}

function articleKey(article) {
  const canonical = canonicalArticleUrl(article.url || article.link);
  if (canonical) return `url:${canonical.toLowerCase()}`;
  return `title:${String(article.title || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${String(article.publishedAt || article.pubDate || '').slice(0, 16)}`;
}

function normalizeAndDedupeArticles(articles) {
  const seen = new Set();
  return (articles || []).map((article) => ({ ...article, url: canonicalArticleUrl(article.url || article.link), link: canonicalArticleUrl(article.link || article.url) }))
    .filter((article) => {
      const key = articleKey(article);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    })
    .sort((a, b) => {
      const left = new Date(a.publishedAt || a.pubDate || 0).getTime() || 0;
      const right = new Date(b.publishedAt || b.pubDate || 0).getTime() || 0;
      return right - left;
    });
}

function sectionRank(section) {
  const name = String(section || '').toLowerCase();
  if (name === 'home') return 90;
  if (name === 'latest' || name === 'official feed') return 100;
  return 10;
}

function buildSections(job) {
  const candidates = (job.articles || []).map((article) => {
    article.section = article.section || 'Latest';
    article.url = canonicalArticleUrl(article.url || article.link);
    article.link = canonicalArticleUrl(article.link || article.url);
    return article;
  });
  // Prefer a specific desk (World, Sport, etc.) over a general Home copy of
  // the same article. This removes cross-section duplicates without losing
  // the article from the meaningful category.
  candidates.sort((left, right) => sectionRank(left.section) - sectionRank(right.section));
  const selected = new Map();
  for (const article of candidates) {
    const key = articleKey(article);
    if (!key || selected.has(key)) continue;
    selected.set(key, article);
  }
  const bySection = new Map();
  for (const article of selected.values()) {
    const name = article.section || 'Latest';
    if (!bySection.has(name)) bySection.set(name, []);
    bySection.get(name).push(article);
  }
  const names = [...new Set([...(job.sectionOrder || []), ...bySection.keys()])];
  return names.map((name) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name,
    articles: (bySection.get(name) || []).sort((a, b) => (new Date(b.publishedAt || b.pubDate || 0).getTime() || 0) - (new Date(a.publishedAt || a.pubDate || 0).getTime() || 0)).slice(0, 50)
  // A category exists only once its validated feed has yielded an article.
  // This prevents empty menu entries invented from labels or URL patterns.
  })).filter((section) => section.articles.length);
}

function hostnameFor(rawUrl) {
  try { return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; }
}

function feedFamilyCandidates() {
  // Kept as a harmless compatibility seam for callers. Feed candidates may
  // only originate from a publisher-declared link, a documented feed
  // directory/OPML, or a URL supplied directly by the user.
  return [];
}

function categoryFromDirectoryLabel(label, url = '', feedTitle = '') {
  // Taxonomy is based on publisher-provided labels, feed URL paths, and validated feed titles.
  const text = `${label || ''} ${feedTitle || ''}`.toLowerCase();
  const urlLower = String(url || '').toLowerCase();

  // Newsround is children's news/entertainment, NEVER sport
  if (/newsround|cbbc_news/i.test(text) || /newsround/i.test(urlLower)) {
    return 'Entertainment';
  }

  // Explicit sport URLs
  if (/\/sport(?:s)?(?:\/|\.|$)/i.test(urlLower) || /sportonline/i.test(urlLower) || /skysports\.com/i.test(urlLower)) {
    return 'Sport';
  }

  const rules = [
    ['Home', /\b(home|top stories|headlines|front page)\b/],
    ['UK', /\b(uk|england|scotland|wales|northern ireland|uk news)\b/],
    ['World', /\b(world|international|global news)\b/],
    ['Politics', /\bpolitic/],
    ['Business', /\b(business|economy|market|markets|finance|money)\b/],
    ['AI', /\b(artificial intelligence|machine learning|generative ai)\b|\bai\b/],
    ['EV', /\b(electric vehicle|electric car|automotive)\b|\bev\b/],
    ['Technology', /\b(technology|tech|innovation|gadgets|software)\b/],
    ['Health', /\b(health|healthcare|wellness|medical|medicine)\b/],
    ['Science', /\b(science|environment|climate|space|nature|physics|biology)\b/],
    ['Entertainment', /\b(entertainment|arts|culture|music|film|films|movies|cinema|tv|showbiz|celebrity)\b/],
    ['Sport', /\b(sport|sports|football|premier league|champions league|soccer|cricket|tennis|rugby|golf|f1|formula 1|motorsport|athletics|boxing|nba|nfl|mlb|baseball|basketball)\b/],
    ['Gaming', /\b(gaming|games|game|esports|playstation|xbox|nintendo)\b/],
    ['Travel', /\b(travel|destinations|tourism|vacations)\b/]
  ];

  const matched = rules.find(([, pattern]) => pattern.test(text) || pattern.test(urlLower));
  return matched ? matched[0] : 'Latest';
}

function directoryFeedLinks(html, directoryUrl) {
  const found = new Map();
  // OPML is a publisher's explicit feed inventory. Preserve its own section
  // label, then map that label to the FeedOmeter taxonomy later.
  const outlines = String(html || '').match(/<outline\b[^>]*>/gi) || [];
  for (const outline of outlines) {
    const href = attribute(outline, 'xmlUrl') || attribute(outline, 'xmlurl');
    const label = cleanText(attribute(outline, 'text') || attribute(outline, 'title') || attribute(outline, 'category') || '');
    if (!href) continue;
    let url;
    try { url = new URL(href, directoryUrl).href; } catch (_) { continue; }
    if (!isPublicHttpUrl(url)) continue;
    found.set(url, { section: categoryFromDirectoryLabel(label, url), name: label || 'Publisher feed', url });
  }
  const anchors = String(html || '').match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const anchor of anchors) {
    const href = attribute(anchor, 'href');
    const label = cleanText(anchor.replace(/<[^>]*>/g, ' '));
    if (!href) continue;
    let url;
    try { url = new URL(href, directoryUrl).href; } catch (_) { continue; }
    if (!isPublicHttpUrl(url) || !/(?:rss|atom|feed|\.xml|\.rdf)(?:[/?#]|$)/i.test(url)) continue;
    found.set(url, { section: categoryFromDirectoryLabel(label, url), name: label || 'Official feed', url });
  }
  return [...found.values()];
}

function detectLanguage(text) {
  if (!text) return 'en';
  const sample = String(text).slice(0, 300);

  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(sample)) return 'ar';
  if (/[\u0590-\u05FF]/.test(sample)) return 'he';
  if (/[\u0400-\u04FF]/.test(sample)) return 'ru';
  if (/[\u4E00-\u9FFF]/.test(sample)) return 'zh';
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(sample)) return 'ja';
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(sample)) return 'ko';
  if (/[\u0900-\u097F]/.test(sample)) return 'hi';
  if (/[\u0980-\u09FF]/.test(sample)) return 'bn';
  if (/[\u0B80-\u0BFF]/.test(sample)) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(sample)) return 'te';
  if (/[\u0E00-\u0E7F]/.test(sample)) return 'th';
  if (/[\u0370-\u03FF]/.test(sample)) return 'el';

  if (/[¿¡]|\b(el|la|los|las|un|una|para|con|por|sobre|del|al)\b/i.test(sample) && /[áéíóúñ]/i.test(sample)) return 'es';
  if (/\b(le|la|les|un|une|des|pour|dans|avec|sur|du|au|aux)\b/i.test(sample) && /[éàèùâêîôûçëïü]/i.test(sample)) return 'fr';
  if (/\b(der|die|das|und|oder|mit|für|von|im|auf|aus)\b/i.test(sample) && /[äöüß]/i.test(sample)) return 'de';
  if (/\b(o|a|os|as|um|uma|para|com|por|sobre|do|da|dos|das)\b/i.test(sample) && /[ãõáéíóúçê]/i.test(sample)) return 'pt';

  return 'en';
}

function isNonEnglishFeed(feed) {
  const url = String((feed && (feed.url || feed.link)) || '').toLowerCase();
  const name = String((feed && (feed.name || feed.title)) || '').toLowerCase();
  const section = String((feed && (feed.section || feed.publisher_section)) || '').toLowerCase();
  const text = `${url} ${name} ${section}`;

  const nonEnglishPatterns = /\b(arabic|persian|urdu|pashto|bengali|hindi|tamil|telugu|gujarati|marathi|chinese|zhongwen|russian|kyrgyz|uzbek|somali|hausa|swahili|yoruba|gahuza|vietnamese|indonesian|mundo|brasil|portuguese|turkish|japanese|korean|spanish|french|german|italian|dutch|polish|ukrainian|thai|greek|hebrew|nepali|sinhala|amharic|tigrinya|afaan|oromo|pidgin|igbo|punjabi|cymru|gwent|scots|gaelic)\b|\/(?:arabic|urdu|persian|pashto|hindi|bengali|tamil|telugu|russian|chinese|zhongwen|mundo|brasil|portuguese|turkish|vietnamese|indonesian|somali|hausa|swahili|japanese|korean|spanish|french|german|italian|ukrainian|thai|greek|hebrew|nepali|sinhala|amharic|tigrinya|afaan|oromo|pidgin|igbo|punjabi|gahuza|cymru|gwent)\//i;

  if (nonEnglishPatterns.test(text)) return true;
  if (/\/(?:zh|ar|ru|es|fr|de|pt|ja|ko|hi|ur|bn|ta|te|fa|tr|vi|id|uk|pl|it|nl|cy)\b/i.test(url)) return true;
  return false;
}

function rankDirectoryFeed(feed) {
  const url = String(feed.url || '').toLowerCase();
  const name = String(feed.name || '').toLowerCase();
  const section = String(feed.section || '').toLowerCase();

  if (isNonEnglishFeed(feed)) return 100;
  if (/top stories|headlines|front page|home/i.test(name) || /top_stories|front_page/i.test(url)) return 1;
  if (/world|uk|news/i.test(section) || /world|uk|news/i.test(name)) return 2;
  if (/business|technology|science|politics|sport/i.test(section) || /business|technology|science|politics|sport/i.test(name)) return 3;

  return 10;
}

async function discoverPublisherDirectoryFeeds(rawUrl, publisherPage) {
  const host = hostnameFor(rawUrl);
  const directoryHost = Object.keys(PUBLISHER_RSS_DIRECTORIES).find((key) => host === key || host.endsWith(`.${key}`));
  const declaredOnPage = publisherPage && publisherPage.ok
    ? directoryFeedLinks(publisherPage.body, publisherPage.url)
        .map((entry) => entry.url)
        .filter((url) => /(?:opml|directory|feeds?)(?:[/?#.]|$)/i.test(url))
    : [];
  const urls = [...new Set([...(directoryHost ? PUBLISHER_RSS_DIRECTORIES[directoryHost] : []), ...declaredOnPage])].slice(0, 6);
  const pages = await mapSettledWithConcurrency(urls, 3, async (url) => {
    const page = await fetchPage(url, 6500);
    return page && page.ok ? directoryFeedLinks(page.body, page.url) : null;
  });
  const discovered = pages.flat();
  const snapshot = directoryHost ? (BLOCKED_DIRECTORY_SNAPSHOTS[directoryHost] || []) : [];
  const merged = [...new Map([...snapshot, ...discovered].map((candidate) => [candidate.url, candidate])).values()];
  const englishOnly = merged.filter((candidate) => !isNonEnglishFeed(candidate));
  return englishOnly.sort((a, b) => rankDirectoryFeed(a) - rankDirectoryFeed(b));
}

async function mapSettledWithConcurrency(items, maxConcurrency, mapper) {
  let cursor = 0;
  const output = [];
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      try { const value = await mapper(item); if (value) output.push(value); } catch (_) {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, worker));
  return output;
}

function makeJob(rawUrl, limit) {
  for (const [id, existing] of previewJobs) if (existing.expiresAt < Date.now()) previewJobs.delete(id);
  const id = crypto.randomUUID();
  const job = { id, targetUrl: rawUrl, limit, createdAt: Date.now(), expiresAt: Date.now() + JOB_TTL_MS, status: 'discovering', name: '', meta: {}, articles: [], inventory: [], sectionOrder: [], feedsScanned: 0, feedsFound: 0, imagesProcessed: 0, imagesResolved: 0, complete: false, errors: [] };
  previewJobs.set(id, job);
  return job;
}

function jobResponse(job, initial = false) {
  const sections = buildSections(job);
  const articles = sections.flatMap((section) => section.articles);
  return {
    status: 'success', success: true, job_id: job.id, url: job.targetUrl,
    name: job.name || hostnameFor(job.targetUrl), articles: articles.slice(0, initial ? FIRST_BATCH_SIZE : job.limit),
    count: Math.min(articles.length, initial ? FIRST_BATCH_SIZE : job.limit), xml: '',
    meta: { title: job.name || hostnameFor(job.targetUrl), link: job.targetUrl, url: job.targetUrl, publisher_feed_count: job.feedsFound },
    discovery: { type: 'publisher_feed_family', feeds_scanned: job.feedsScanned, feeds_found: job.feedsFound },
    feed_inventory: job.inventory.map((feed) => ({ ...feed })),
    sections: sections.map((section) => ({ id: section.id, name: section.name, count: section.articles.length, articles: section.articles.slice(0, initial ? FIRST_BATCH_SIZE : 50) })),
    progress: { status: job.complete ? 'complete' : job.status, complete: job.complete, articles_found: articles.length, feeds_scanned: job.feedsScanned, feeds_found: job.feedsFound, images_processed: job.imagesProcessed, images_resolved: job.imagesResolved }
  };
}

async function runPublisherJob(job, direct) {
  const candidates = feedFamilyCandidates(job.targetUrl, direct && direct.url);
  if (direct && isFeedDocument(direct.body)) candidates.unshift({ name: 'Direct feed', url: direct.url });
  const [directoryFeeds, advertised] = await Promise.all([
    discoverPublisherDirectoryFeeds(job.targetUrl, direct),
    direct && direct.ok && !isFeedDocument(direct.body)
      ? discoverFeedFromWebsite({ website_url: direct.url, source_engine: 'website-preview' })
      : Promise.resolve([])
  ]);
  candidates.push(...directoryFeeds);
  for (const candidate of advertised) candidates.push({ section: categoryFromDirectoryLabel(candidate.feed_name, candidate.feed_url), name: candidate.feed_name || 'Official feed', url: candidate.feed_url });
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
    .filter((candidate) => !isNonEnglishFeed(candidate));
  job.sectionOrder = [...new Set(uniqueCandidates.map((candidate) => candidate.section || 'Latest'))];
  if (!uniqueCandidates.length) throw new Error('No public RSS or Atom feeds were discovered for this publisher.');
  job.status = 'retrieving';
  await mapSettledWithConcurrency(uniqueCandidates, 8, async (candidate) => {
    const page = await fetchPage(candidate.url, 3500);
    job.feedsScanned += 1;
    if (!page || !page.ok || !isFeedDocument(page.body)) return null;
    const parsed = parseFeed(page.body, page.url);
    if (!parsed.valid) return null;
    const resolvedSection = candidate.provenance === 'publisher_directory_snapshot' && candidate.section
      ? candidate.section
      : categoryFromDirectoryLabel(`${candidate.section || ''} ${candidate.name || ''}`, page.url, parsed.title);
    job.inventory.push({ url: page.url, title: parsed.title, type: /^\s*\{/.test(page.body) ? 'json_feed' : /^\s*<feed\b/i.test(page.body) ? 'atom' : 'rss', publisher_section: candidate.section || '', category: resolvedSection, discovery_provenance: candidate.provenance || 'publisher_declared', item_count: parsed.items.length, validated_at: Date.now() });
    const discoveryType = /^\s*\{/.test(page.body) ? 'json_feed' : /^\s*<feed\b/i.test(page.body) ? 'atom' : 'rss';
    const items = parsed.items.map((article) => ({ ...article, source: parsed.title || candidate.name, publisher_section: candidate.section || '', section: resolvedSection, discovery_type: discoveryType, discovery_provenance: candidate.provenance || 'publisher_declared' }));
    job.feedsFound += 1;
    job.name = job.name || parsed.title || hostnameFor(job.targetUrl);
    job.articles.push(...items);
    return true;
  });
  // Keep raw section identity until response construction. buildSections()
  // performs cross-section de-duplication while choosing the specific desk.
  job.status = 'enriching_images';
  const visibleArticles = buildSections(job).flatMap((section) => section.articles);
  const articlesNeedingImages = visibleArticles.filter(
    (a) => !a.image && !a.ogImage && !a.thumbnail && isPublicHttpUrl(a.url || a.link)
  ).slice(0, 10);

  if (articlesNeedingImages.length > 0) {
    await mapSettledWithConcurrency(articlesNeedingImages, 6, async (article) => {
      const page = await fetchPage(article.url || article.link, 2500);
      job.imagesProcessed += 1;
      if (!page || !page.ok) return null;
      const image = metaContent(page.body, ['og:image', 'twitter:image', 'twitter:image:src']);
      if (!isPublicHttpUrl(image) || !isUsableImage(image)) return null;
      article.image = upgradeImageUrl(image);
      job.imagesResolved += 1;
      return true;
    });
  }
  job.status = 'complete'; job.complete = true;
}

function startPublisherJob(rawUrl, direct, limit) {
  const job = makeJob(rawUrl, limit);
  runPublisherJob(job, direct).catch((error) => { job.errors.push(error.message); job.status = 'complete'; job.complete = true; });
  return job;
}

function getPreviewJob(id) {
  const job = previewJobs.get(String(id || ''));
  if (!job || job.expiresAt < Date.now()) { if (job) previewJobs.delete(job.id); return null; }
  return jobResponse(job, false);
}

async function waitForFirstBatch(job, maxWaitMs = 1200) {
  const started = Date.now();
  while (!job.complete && normalizeAndDedupeArticles(job.articles).length < FIRST_BATCH_SIZE && Date.now() - started < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return jobResponse(job, true);
}

function xmlTag(xml, tagName) {
  const escaped = tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? cleanText(match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, '$1')) : '';
}

function parseFeed(xml, feedUrl) {
  if (/^\s*\{/.test(String(xml || ''))) {
    try {
      const feed = JSON.parse(xml);
      const items = (feed.items || []).map((item) => {
        const url = item.url || item.external_url || '';
        const itemTitle = String(item.title || '').trim();
        const itemDesc = item.summary || item.content_text || item.content_html || '';
        const detectedLang = detectLanguage(itemTitle + ' ' + itemDesc);
        return {
          id: item.id || `preview_${crypto.createHash('sha1').update(url || item.title || '').digest('hex')}`,
          title: itemTitle,
          link: url,
          url,
          description: itemDesc,
          pubDate: item.date_published || item.date_modified || '',
          publishedAt: item.date_published || item.date_modified || '',
          author: item.authors && item.authors[0] && item.authors[0].name || '',
          image: item.image || item.banner_image || '',
          source: String(feed.title || '').trim(),
          language: detectedLang,
          lang: detectedLang
        };
      }).filter((item) => item.title && !/^untitled(?: article)?$/i.test(item.title) && isPublicHttpUrl(item.url) && item.language === 'en');
      const title = String(feed.title || '').trim();
      return { title, link: feed.home_page_url || feedUrl, items, valid: Boolean(/^https:\/\/jsonfeed\.org\/version\//i.test(String(feed.version || '')) && title && items.length) };
    } catch (_) { return { title: '', link: feedUrl, items: [], valid: false }; }
  }
  const sourceTitle = xmlTag(xml, 'channel') ? xmlTag((String(xml).match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i) || [])[1], 'title') : xmlTag(xml, 'title');
  const itemMatches = [...String(xml || '').matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];
  const articles = itemMatches.map((match) => {
    const item = match[1];
    const rawLink = xmlTag(item, 'link') || ((item.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i) || [])[1] || '');
    const rawImage = ((item.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl=["']([^"']+)["']/i) || [])[1] || ((item.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i) || [])[1] || ''));
    const image = isUsableImage(rawImage) ? upgradeImageUrl(rawImage) : '';
    const itemTitle = xmlTag(item, 'title') || 'Untitled article';
    const itemDesc = xmlTag(item, 'description') || xmlTag(item, 'summary') || xmlTag(item, 'content:encoded') || xmlTag(item, 'content');
    const detectedLang = detectLanguage(itemTitle + ' ' + itemDesc);
    return {
      id: `preview_${crypto.createHash('sha1').update(rawLink || xmlTag(item, 'title')).digest('hex')}`,
      title: itemTitle,
      link: rawLink,
      url: rawLink,
      description: itemDesc,
      pubDate: xmlTag(item, 'pubDate') || xmlTag(item, 'published') || xmlTag(item, 'updated') || xmlTag(item, 'dc:date'),
      publishedAt: xmlTag(item, 'pubDate') || xmlTag(item, 'published') || xmlTag(item, 'updated') || xmlTag(item, 'dc:date'),
      author: xmlTag(item, 'dc:creator') || xmlTag(item, 'author'),
      image,
      source: sourceTitle || 'Feed preview',
      language: detectedLang,
      lang: detectedLang
    };
  }).filter((item) => {
    const title = String(item.title || '').trim();
    return title && !/^untitled(?: article)?$/i.test(title) && isPublicHttpUrl(item.url) && item.language === 'en';
  });
  const title = String(sourceTitle || '').trim();
  return { title, link: feedUrl, items: articles, valid: Boolean(title && !/^feed preview$/i.test(title) && articles.length) };
}

function likelyArticleLinks(html, pageUrl, limit) {
  const page = new URL(pageUrl);
  const ignored = /^(#|javascript:|mailto:|tel:)/i;
  const pathNoise = /\/(?:tag|tags|topic|topics|category|categories|search|account|login|privacy|terms|about|contact)(?:\/|$)/i;
  const seen = new Set();
  const candidates = [];
  const anchors = String(html || '').match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const anchor of anchors) {
    const href = attribute(anchor, 'href');
    const title = cleanText(anchor.replace(/<[^>]*>/g, ' '));
    if (!href || ignored.test(href) || title.length < 18) continue;
    let url;
    try { url = new URL(href, pageUrl); } catch (_) { continue; }
    if (!/^https?:$/.test(url.protocol) || url.hostname !== page.hostname || pathNoise.test(url.pathname)) continue;
    url.hash = '';
    const key = url.href;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ url: key, title: title.slice(0, 500) });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

async function mapWithConcurrency(items, maxConcurrency, mapper) {
  let cursor = 0;
  const output = [];
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      const value = await mapper(item);
      if (value) output.push(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, worker));
  return output;
}

async function scrapeArticles(page, limit) {
  const links = likelyArticleLinks(page.body, page.url, Math.min(limit * 2, 50));
  const articles = await mapWithConcurrency(links, 3, async (candidate) => {
    const articlePage = await fetchPage(candidate.url, 6000);
    if (!articlePage || !articlePage.ok || !/text\/html/i.test(articlePage.contentType || 'text/html')) return null;
    const title = titleFromHtml(articlePage.body) || candidate.title;
    const description = metaContent(articlePage.body, ['og:description', 'description', 'twitter:description']);
    const image = metaContent(articlePage.body, ['og:image', 'twitter:image', 'twitter:image:src']);
    return {
      id: `preview_${crypto.createHash('sha1').update(articlePage.url).digest('hex')}`,
      title: title || 'Untitled article', link: articlePage.url, url: articlePage.url,
      description, pubDate: '', publishedAt: '', image, source: titleFromHtml(page.body) || new URL(page.url).hostname
    };
  });
  return articles.slice(0, limit);
}

function sitemapLocations(xml, baseUrl) {
  const locations = [...String(xml || '').matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) => cleanText(match[1])).filter(isPublicHttpUrl);
  return [...new Set(locations.map((value) => { try { return new URL(value, baseUrl).href; } catch (_) { return ''; } }).filter(Boolean))];
}

function declaredSitemapUrls(html, pageUrl) {
  const urls = [];
  const tags = String(html || '').match(/<(?:a|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const href = attribute(tag, 'href');
    if (!href || !/sitemap/i.test(href)) continue;
    try {
      const resolved = new URL(href, pageUrl).href;
      if (isPublicHttpUrl(resolved)) urls.push(resolved);
    } catch (_) {}
  }
  return [...new Set(urls)];
}

async function discoverSitemapArticles(pageUrl, limit, pageHtml = '') {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch (_) { return []; }
  const robots = await fetchPage(new URL('/robots.txt', origin).href, 4500);
  const robotMaps = robots && robots.ok ? String(robots.body || '').match(/^sitemap:\s*(\S+)/gim) || [] : [];
  // Sitemap roots must be declared in robots.txt or publisher HTML. Do not
  // probe assumed sitemap locations.
  const roots = [...new Set([
    ...robotMaps.map((line) => line.replace(/^sitemap:\s*/i, '').trim()),
    ...declaredSitemapUrls(pageHtml, pageUrl)
  ])].filter(isPublicHttpUrl);
  if (!roots.length) return [];
  const rootPages = await mapSettledWithConcurrency(roots, 3, (url) => fetchPage(url, 6000));
  let locations = rootPages.flatMap((page) => page && page.ok ? sitemapLocations(page.body, page.url) : []);
  const childMaps = locations.filter((url) => /(?:sitemap|\.xml)(?:[?#]|$)/i.test(url)).slice(0, 4);
  if (childMaps.length) {
    const childPages = await mapSettledWithConcurrency(childMaps, 3, (url) => fetchPage(url, 6000));
    locations = locations.concat(childPages.flatMap((page) => page && page.ok ? sitemapLocations(page.body, page.url) : []));
  }
  const host = new URL(pageUrl).hostname;
  return [...new Set(locations.filter((url) => { try { const u = new URL(url); return u.hostname === host && !/\.xml(?:[?#]|$)/i.test(u.pathname); } catch (_) { return false; } }))].slice(0, Math.max(limit * 2, 50));
}

async function structuredArticlesFromUrls(urls, sourceName, limit) {
  const articles = await mapSettledWithConcurrency((urls || []).slice(0, Math.max(limit * 2, 50)), 3, async (url) => {
    const page = await fetchPage(url, 6000);
    if (!page || !page.ok || !/text\/html/i.test(page.contentType || 'text/html')) return null;
    const title = titleFromHtml(page.body);
    if (!title || /^untitled(?: article)?$/i.test(title)) return null;
    return { id: `preview_${crypto.createHash('sha1').update(page.url).digest('hex')}`, title, link: page.url, url: page.url, description: metaContent(page.body, ['og:description', 'description', 'twitter:description']), pubDate: '', publishedAt: '', image: metaContent(page.body, ['og:image', 'twitter:image', 'twitter:image:src']), source: sourceName || new URL(page.url).hostname, discovery_type: 'sitemap' };
  });
  return normalizeAndDedupeArticles(articles).slice(0, limit);
}

function restrictedRecovery() {
  return {
    type: 'site_access_restricted',
    suggestions: ['Try the publisher’s official RSS or Atom URL', 'Search FeedOmeter’s feed directory', 'Use Visual Builder for an accessible page']
  };
}

async function previewWebsite(rawUrl, options = {}) {
  const targetUrl = String(rawUrl || '').trim();
  if (!isPublicHttpUrl(targetUrl)) throw new Error('Enter a safe public HTTP(S) website or feed URL.');
  const limit = Math.max(FIRST_BATCH_SIZE, Math.min(Number(options.limit) || DEFAULT_LIMIT, 250));

  // A direct RSS/Atom URL remains the fastest path when a person pastes an
  // actual feed URL. Publisher web pages, however, enter the feed-family path
  // below so one page does not arbitrarily become the only source.
  const direct = await fetchPage(targetUrl);
  if (direct && direct.ok && isFeedDocument(direct.body)) {
    const parsed = parseFeed(direct.body, direct.url);
    if (parsed.valid) return { status: 'success', success: true, url: direct.url, name: parsed.title, articles: parsed.items.slice(0, limit), count: Math.min(parsed.items.length, limit), xml: direct.body, meta: { title: parsed.title, link: parsed.link, url: direct.url }, discovery: { type: 'direct_feed' } };
  }

  // Start publisher-declared feeds concurrently. This also works when the
  // home page rejects our request if a documented publisher directory exists.
  const job = startPublisherJob(targetUrl, direct && direct.ok ? direct : null, limit);
  const early = await waitForFirstBatch(job);
  if (early && (early.articles.length > 0 || !early.progress.complete)) return early;

  // Preserve the existing webpage-scrape behavior for a site that is
  // accessible but has not yet yielded RSS articles. The job continues in the
  // background and the browser will merge its later RSS results by job id.
  if (direct && direct.ok) {
    const sitemapUrls = await discoverSitemapArticles(direct.url, FIRST_BATCH_SIZE, direct.body);
    const sitemapArticles = await structuredArticlesFromUrls(sitemapUrls, titleFromHtml(direct.body) || new URL(direct.url).hostname, FIRST_BATCH_SIZE);
    if (sitemapArticles.length) {
      job.articles.push(...sitemapArticles.map((article) => ({ ...article, section: categoryFromDirectoryLabel(`${article.title} ${article.description}`, article.url), publisher_section: '', discovery_type: 'sitemap' })));
      job.name = job.name || titleFromHtml(direct.body) || new URL(direct.url).hostname;
      return jobResponse(job, true);
    }
    const articles = await scrapeArticles(direct, FIRST_BATCH_SIZE);
    if (articles.length) {
      job.articles.push(...articles.map((article) => ({ ...article, section: categoryFromDirectoryLabel(`${article.title} ${article.description}`, article.url), publisher_section: '', discovery_type: 'structured_scrape' })));
      job.name = job.name || titleFromHtml(direct.body) || new URL(direct.url).hostname;
      return jobResponse(job, true);
    }
  }
  if (early && !early.progress.complete) return early;
  if (!direct || !direct.ok) {
    const error = new Error('Unable to extract articles from this website. It may be protected or JavaScript-rendered.');
    error.recovery = restrictedRecovery();
    throw error;
  }
  const error = new Error('Unable to extract articles from this website. It may be protected or JavaScript-rendered.');
  error.recovery = restrictedRecovery();
  throw error;
}

module.exports = { previewWebsite, getPreviewJob };
