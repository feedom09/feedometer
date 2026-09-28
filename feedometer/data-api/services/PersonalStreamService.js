/**
 * Builds a signed-in user's digest from only their followed RSS sources.
 * This is deliberately separate from public discovery and SQL article storage:
 * a newly followed source can contribute to the digest immediately.
 */

const crypto = require('crypto');
const FeedService = require('./FeedService');

function cleanText(value = '') {
  return String(value)
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml, name) {
  const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? cleanText(match[1]) : '';
}

function attribute(xml, elementName, attributeName) {
  const element = elementName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const attr = attributeName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${element}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*\\/?`, 'i'));
  return match ? cleanText(match[1]) : '';
}

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
  // Preserve known signed/transform URLs, but request a practical editorial
  // source size from CDNs that support dimension parameters.
  if (!/i\.guim\.co\.uk/i.test(value)) {
    value = value.replace(/ichef\.bbci\.co\.uk\/news\/\d+\//i, 'ichef.bbci.co.uk/news/1024/');
    value = value.replace(/ichef\.bbci\.co\.uk\/ace\/standard\/\d+\//i, 'ichef.bbci.co.uk/ace/standard/1024/');
    value = value.replace(/([?&])(w|width)=\d+/ig, '$1$2=1200');
    value = value.replace(/([?&])(h|height)=\d+/ig, '$1$2=800');
    value = value.replace(/resize=\d+,\d+/i, 'resize=1200,800');
    value = value.replace(/\/(default|mqdefault|sddefault)\.jpg/i, '/hqdefault.jpg');
  }
  return value;
}

function firstHtmlImage(html) {
  const match = String(html || '').match(/<img[^>]+(?:src|data-src|data-orig-file|data-lazy-src)=["']([^"']+)["']/i);
  return match && isUsableImage(match[1]) ? upgradeImageUrl(match[1]) : '';
}

function youtubePoster(articleUrl) {
  const match = String(articleUrl || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : '';
}

function selectArticleImage({ candidates = [], articleUrl = '', html = '' } = {}) {
  for (const candidate of candidates) {
    if (isUsableImage(candidate)) return upgradeImageUrl(candidate);
  }
  return youtubePoster(articleUrl) || firstHtmlImage(html);
}

function parseEntries(xml) {
  const rssItems = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const atomEntries = rssItems.length ? [] : [...String(xml || '').matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const isAtom = atomEntries.length > 0;
  return (isAtom ? atomEntries : rssItems).map((entry) => {
    const url = isAtom ? attribute(entry, 'link', 'href') : (tag(entry, 'link') || tag(entry, 'guid'));
    const rawSummary = tag(entry, isAtom ? 'summary' : 'description') || tag(entry, isAtom ? 'content' : 'content:encoded');
    const rawContent = tag(entry, isAtom ? 'content' : 'content:encoded');
    return {
      title: tag(entry, 'title') || 'Untitled',
      url,
      snippet: cleanText(rawSummary),
      author: isAtom ? tag(entry, 'name') : (tag(entry, 'dc:creator') || tag(entry, 'author')),
      published_at: tag(entry, isAtom ? 'published' : 'pubDate') || tag(entry, isAtom ? 'updated' : 'dc:date'),
      image_url: selectArticleImage({
        candidates: [
          attribute(entry, 'media:content', 'url'),
          attribute(entry, 'media:thumbnail', 'url'),
          attribute(entry, 'enclosure', 'url')
        ],
        articleUrl: url,
        html: `${rawContent} ${rawSummary}`
      })
    };
  }).filter((entry) => entry.url || entry.title !== 'Untitled');
}

async function fetchSource(source, edgeOrigin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const endpoint = `${edgeOrigin}/api/edge/feed?url=${encodeURIComponent(source.feed_url)}`;
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { accept: 'application/xml, text/xml, application/rss+xml, application/atom+xml' }
    });
    if (!response.ok) return [];
    const entries = parseEntries(await response.text());
    return entries.map((entry) => ({
      id: `live_${crypto.createHash('sha1').update(`${source.source_id}|${entry.url || entry.title}`).digest('hex')}`,
      source_id: source.source_id,
      source_name: source.title || source.source_name || 'RSS Feed',
      source_site_url: source.website_url || '',
      source_icon_url: source.logo_url || '',
      source_category: source.category || 'General',
      ...entry,
      is_starred: 0,
      is_saved: 0,
      is_read: 0
    }));
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function getStreamForSources(sources, { limit = 50 } = {}) {
  const scopedSources = Array.isArray(sources) ? sources.filter((source) => source && source.feed_url) : [];
  const edgeOrigin = String(process.env.EDGE_WORKER_ORIGIN || '').replace(/\/$/, '');
  if (!scopedSources.length || !edgeOrigin) return [];

  // A small concurrency pool avoids making one slow feed block the whole digest.
  const results = [];
  const queue = [...scopedSources];
  const worker = async () => {
    while (queue.length) {
      const source = queue.shift();
      results.push(...await fetchSource(source, edgeOrigin));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, scopedSources.length) }, worker));

  const seen = new Set();
  return results
    .filter((item) => {
      const key = String(item.url || item.id).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0))
    .slice(0, Math.min(Math.max(Number(limit) || 50, 1), 100));
}

async function getPersonalStream(userId, { limit = 50, folderId = null } = {}) {
  const sources = await FeedService.getUserFeeds(userId);
  const scopedSources = folderId ? sources.filter((source) => source.folder_id === folderId) : sources;
  return getStreamForSources(scopedSources, { limit });
}

module.exports = { getPersonalStream, getStreamForSources };
