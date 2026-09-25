/**
 * workers/services/feed-imaging.js
 * --------------------------------------------------------------------------
 * PURPOSE (plain language)
 * --------------------------------------------------------------------------
 * RSS feeds often give us a messy mix of real photos, tiny tracking pixels,
 * favicons, and small thumbnails. The browser used to pick the "best photo"
 * in feed-imaging.js — which meant anyone could read those rules in DevTools.
 *
 * That work now lives HERE on the Worker. Public pages should only display
 * the `image` / `image_url` field the API already chose.
 *
 * HOW TO READ THIS FILE
 *   1. cleanImageUrl     — make a URL usable (https, decode &amp;)
 *   2. isJunkImageUrl    — skip pixels, sprites, tiny icons
 *   3. upscaleImageUrl   — ask CDNs for a larger copy when it is safe
 *   4. youtubeThumbnailFromUrl — if the story is a YouTube link, use its poster
 *   5. firstImageInHtml  — fallback: first <img> inside the RSS HTML body
 *   6. pickBestArticleImage — the one function other modules should call
 *
 * Used by:
 *   - article-normalizer.js  (Home / Top Stories stream cards)
 *   - modules/articles.js    (star / save catalog + starred list)
 */
'use strict';

const TRUSTED_MEDIA_HOSTS = /i\.guim\.co\.uk|ichef\.bbci\.co\.uk|espncdn\.com|media\.npr\.org|static01\.nyt\.com|wsj\.net|reuters\.com|theguardian\.com|cdn\.vox-cdn\.com|arstechnica\.net|techcrunch\.com|wp\.com/i;
const JUNK_URL_HINTS = /favicon|sprite|gravatar|gstatic\.com\/favicon|doubleclick|scorecardresearch|pixel\.(gif|png|jpe?g)|spacer|1x1|tracking|quantserve|beacon/i;
const SIGNED_URL_HINTS = /[?&](s|sig|signature|token|hmac|auth|hash)=/i;

/**
 * Turn a raw RSS/HTML image value into a normal https URL.
 * Example: "//ichef.bbci.co.uk/..." becomes "https://ichef.bbci.co.uk/..."
 */
export function cleanImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let url = raw.trim().replace(/&amp;/g, '&').replace(/&quot;/g, '').replace(/&#39;/g, "'");
  if (url.indexOf('//') === 0) url = 'https:' + url;
  return url;
}

/**
 * Return true if this URL is probably NOT a real article photo.
 * We keep trusted news CDNs unless the path itself looks like a 1x1 pixel.
 */
export function isJunkImageUrl(raw) {
  const url = cleanImageUrl(raw);
  if (!url || !/^https?:\/\//i.test(url)) return true;
  const lower = url.toLowerCase();

  if (TRUSTED_MEDIA_HOSTS.test(lower)) {
    return /pixel|spacer|1x1|tracking|beacon/i.test(lower);
  }
  if (JUNK_URL_HINTS.test(lower)) return true;
  if (/\.(svg)(\?|$)/i.test(lower) && /icon|logo|badge|button|arrow|chevron/i.test(lower)) return true;
  if (/\/(1|2|8|16|24|32)x\1\b/i.test(lower)) return true;
  if (/[?&](w|width|h|height)=([1-9]|[12][0-9])\b/i.test(lower)) return true;
  return false;
}

/**
 * Ask known CDNs for a larger image. We do NOT rewrite signed URLs
 * (Guardian, tokens) because changing query params would break them.
 */
export function upscaleImageUrl(raw) {
  let url = cleanImageUrl(raw);
  if (!url) return '';
  if (SIGNED_URL_HINTS.test(url) || /i\.guim\.co\.uk/i.test(url)) return url;

  url = url.replace(/ichef\.bbci\.co\.uk\/news\/\d+\//i, 'ichef.bbci.co.uk/news/1024/');
  url = url.replace(/ichef\.bbci\.co\.uk\/ace\/standard\/\d+\//i, 'ichef.bbci.co.uk/ace/standard/1024/');
  url = url.replace(/_\d{3,4}x\d{3,4}(_\d+-\d+)?(\.(jpe?g|png|webp))/i, '_1296x729_16-9$2');
  url = url.replace(/([?&])(w|width)=\d+/ig, '$1$2=1200');
  url = url.replace(/([?&])(h|height)=\d+/ig, '$1$2=800');
  url = url.replace(/resize=\d+,\d+/i, 'resize=1200,800');
  url = url.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp))/i, '$1');
  url = url.replace(/\/s\d{2,3}(-c)?\//i, '/s1200/');
  url = url.replace(/\/(default|mqdefault|sddefault)\.jpg/i, '/hqdefault.jpg');
  return url;
}

/**
 * If the article URL is a YouTube watch/embed/short, return the standard poster image.
 */
export function youtubeThumbnailFromUrl(articleUrl) {
  if (!articleUrl || typeof articleUrl !== 'string') return '';
  const match = articleUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (!match || !match[1]) return '';
  return 'https://img.youtube.com/vi/' + match[1] + '/hqdefault.jpg';
}

/**
 * Last-resort: find the first <img src> or data-src inside RSS HTML.
 */
export function firstImageInHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const decoded = html
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
  const combined = html + ' ' + decoded;
  const match = combined.match(/<img[^>]+(?:src|data-src|data-orig-file|data-lazy-src)=["']([^"']+)["']/i);
  if (!match || !match[1]) return '';
  const url = cleanImageUrl(match[1]);
  if (!url || isJunkImageUrl(url)) return '';
  return upscaleImageUrl(url);
}

/**
 * Accept a candidate URL only if it looks like a real photo, then upscale it.
 */
function acceptPhoto(raw) {
  const cleaned = cleanImageUrl(raw);
  if (!cleaned || isJunkImageUrl(cleaned)) return '';
  return upscaleImageUrl(cleaned);
}

/**
 * THE MAIN FUNCTION — pick one thumbnail for an article.
 *
 * Look-up order (stop at the first good photo):
 *   1. Fields the feed already set: image_url, image, thumbnail
 *   2. YouTube poster, if the story link is a video
 *   3. First <img> in content / snippet / summary / description HTML
 *
 * Returns a string URL, or '' if nothing usable was found.
 */
export function pickBestArticleImage(article) {
  if (!article) return '';

  const fromFields = acceptPhoto(article.image_url) || acceptPhoto(article.image) || acceptPhoto(article.thumbnail);
  if (fromFields) return fromFields;

  const fromYoutube = youtubeThumbnailFromUrl(article.url || article.link);
  if (fromYoutube) return fromYoutube;

  const html = [
    article.content,
    article.snippet,
    article.summary,
    article.description
  ].filter(Boolean).join(' ');
  return firstImageInHtml(html);
}
