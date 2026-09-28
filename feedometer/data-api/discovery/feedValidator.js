const { canonicalFeedUrl } = require('./normalizer');

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0' || host === '::1') return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch (_) { return false; }
}

async function fetchText(url, timeoutMs = 6000) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8', 'user-agent': 'FeedOmeter RSS Discovery/2.1' } });
    const body = await response.text(); return { ok: response.ok, url: response.url || url, body: body.slice(0, 512000), contentType: response.headers.get('content-type') || '' };
  } catch (_) { return null; } finally { clearTimeout(timeout); }
}

function isFeedDocument(body) {
  let xml = String(body || '').replace(/^\uFEFF/, '').trimStart();
  xml = xml.replace(/^<\?xml\b[^>]*\?>\s*/i, '').replace(/^(?:<!--([\s\S]*?)-->\s*)+/i, '');
  if (/^(?:<rss\b|<feed\b|<rdf:RDF\b)/i.test(xml)) return true;
  try {
    const value = JSON.parse(xml);
    return /^https:\/\/jsonfeed\.org\/version\//i.test(String(value.version || '')) && Array.isArray(value.items) && value.items.some((item) => item && (item.url || item.external_url) && item.title);
  } catch (_) { return false; }
}

async function validateFeedCandidate(candidate, timeoutMs = 3500) {
  const feedUrl = canonicalFeedUrl(candidate && candidate.feed_url);
  if (!isPublicHttpUrl(feedUrl)) return null;
  const result = await fetchText(feedUrl, timeoutMs);
  if (!result || !result.ok || !isPublicHttpUrl(result.url) || !isFeedDocument(result.body)) return null;
  return { ...candidate, feed_url: canonicalFeedUrl(result.url), canonical_feed_url: canonicalFeedUrl(result.url), validated_at: Date.now(), feed_health_pct: 100 };
}

function alternateFeedUrls(html, pageUrl) {
  const urls = []; const pattern = /<link\b[^>]*>/gi; let match;
  while ((match = pattern.exec(String(html || ''))) !== null) {
    const tag = match[0]; const rel = /\brel=["']?([^"'\s>]+)/i.exec(tag); const type = /\btype=["']?([^"'\s>]+)/i.exec(tag); const href = /\bhref=["']([^"']+)["']/i.exec(tag);
    if (href && rel && /alternate/i.test(rel[1]) && type && /application\/(?:rss\+xml|atom\+xml|feed\+json)/i.test(type[1])) {
      try { urls.push(new URL(href[1], pageUrl).href); } catch (_) {}
    }
  }
  return [...new Set(urls)];
}

async function discoverFeedFromWebsite(candidate) {
  if (!candidate || !isPublicHttpUrl(candidate.website_url)) return [];
  const page = await fetchText(candidate.website_url); if (!page || !page.ok || !isPublicHttpUrl(page.url)) return [];
  const candidates = alternateFeedUrls(page.body, page.url);
  // Follow only feed locations explicitly declared by the publisher page.
  // Conventional /feed and /rss paths are guesses, so they are intentionally
  // not tried here.
  const found = [];
  for (const feedUrl of candidates.slice(0, 12)) {
    const validated = await validateFeedCandidate({ ...candidate, feed_url: feedUrl, source_engine: candidate.source_engine });
    if (validated) found.push(validated);
  }
  return found;
}
module.exports = { isPublicHttpUrl, validateFeedCandidate, discoverFeedFromWebsite };
