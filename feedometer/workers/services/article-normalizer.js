/**
 * workers/services/article-normalizer.js — Canonical URL Normalization & Article Identity
 *
 * After we clean the title and URL, we also attach a thumbnail here so Home /
 * Top Stories never need browser-side image picking. See feed-imaging.js.
 */
import { sha256Hex } from '../lib/crypto.js';
import { pickBestArticleImage } from './feed-imaging.js';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid', '_ga', 'ved', 'usg'
]);

export function canonicalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = ''; // Strip fragments

    // Strip tracking parameters
    const keysToDelete = [];
    for (const key of parsed.searchParams.keys()) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(k => parsed.searchParams.delete(k));

    // Remove trailing slash on non-root paths
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch (e) {
    return rawUrl.trim().split('#')[0];
  }
}

export function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num));
}

export function sanitizeText(str) {
  if (!str) return '';
  return decodeHtmlEntities(str)
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePublishedDate(rawValue, fallbackNow = Date.now()) {
  const raw = String(rawValue || '').trim();
  const parsed = raw ? new Date(raw).getTime() : NaN;
  // Keep an explicit fallback rather than persisting an invalid/NaN date.
  return new Date(Number.isFinite(parsed) ? parsed : fallbackNow).toISOString();
}

export async function generateArticleHash(link, feedUrl = '', fallbackTitle = '') {
  const canonical = canonicalizeUrl(link);
  if (canonical) {
    return await sha256Hex(canonical);
  }
  const fallbackStr = `${feedUrl}::${fallbackTitle}`;
  return await sha256Hex(fallbackStr);
}

export async function generateContentFingerprint(title = '', snippet = '') {
  const cleanTitle = sanitizeText(title).toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanSnippet = sanitizeText(snippet).toLowerCase().slice(0, 80).replace(/[^a-z0-9]/g, '');
  return await sha256Hex(`${cleanTitle}::${cleanSnippet}`);
}

export async function generateDedupLadder(item, feedUrl = '') {
  const canonical = canonicalizeUrl(item.link || item.url || item.guid);
  const platform = item.platform || 'rss';
  const sourcePostId = item.source_post_id || item.guid || '';

  const level1 = sourcePostId ? await sha256Hex(`${platform}:${sourcePostId}`) : '';
  const level2 = canonical ? await sha256Hex(canonical) : '';
  const level3 = await generateContentFingerprint(item.title, item.description || item.summary || item.snippet);

  return {
    level1_platform_id: level1,
    level2_url_hash: level2 || level1,
    level3_content_hash: level3
  };
}

export async function normalizeArticle(rawItem, sourceInfo = {}) {
  const canonicalLink = canonicalizeUrl(rawItem.link || rawItem.guid);
  const title = sanitizeText(rawItem.title) || 'Untitled Article';
  const summary = sanitizeText(rawItem.summary || rawItem.description || '');
  const id = await generateArticleHash(canonicalLink, sourceInfo.feed_url || '', title);
  const author = sanitizeText(rawItem.author || '');
  const platform = rawItem.platform || sourceInfo.source_type || 'rss';
  const sourcePostId = rawItem.source_post_id || rawItem.guid || '';

  // Normalize ISO publication timestamp
  const published = normalizePublishedDate(rawItem.published || rawItem.pubDate || rawItem.updated);

  const chosenImage = pickBestArticleImage({
    image: rawItem.image,
    image_url: rawItem.image,
    thumbnail: rawItem.thumbnail,
    content: rawItem.content || rawItem.summary || '',
    snippet: summary,
    url: canonicalLink || rawItem.link || '',
    link: canonicalLink || rawItem.link || ''
  }) || '';

  return {
    id,
    source_post_id: sourcePostId,
    platform: platform,
    title,
    summary,
    description: summary,
    link: canonicalLink || rawItem.link || '',
    url: canonicalLink || rawItem.link || '',
    published,
    pubDate: published,
    publishedAt: published,
    author,
    source: {
      id: sourceInfo.id || 'unknown',
      title: sourceInfo.title || 'Feed Source',
      feed_url: sourceInfo.feed_url || '',
      website_url: sourceInfo.website_url || '',
      logo_url: sourceInfo.logo_url || '',
      source_type: platform
    },
    image: chosenImage,
    image_url: chosenImage
  };
}
