/**
 * workers/services/metadata-scraper.js — OpenGraph & HTML Metadata Extractor Service
 */
import { pickBestArticleImage } from './feed-imaging.js';

export function decodeEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function pickMetaContent(html, property) {
  const re1 = new RegExp('property=["\']' + property + '["\'][^>]*content=["\']([^"\']+)', 'i');
  const re2 = new RegExp('content=["\']([^"\']+)["\'][^>]*property=["\']' + property + '["\']', 'i');
  const re3 = new RegExp('name=["\']' + property + '["\'][^>]*content=["\']([^"\']+)', 'i');
  const match = html.match(re1) || html.match(re2) || html.match(re3);
  return match ? decodeEntities(match[1]).trim() : '';
}

export async function fetchPageMetadata(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FeedOmeter/2.1; +https://feedometer.com)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 250000);
    const titleTag = (html.match(/<title[^>]*>([^<]+)/i) || [])[1] || '';
    const title = pickMetaContent(html, 'og:title') || decodeEntities(titleTag).replace(/\s+[|\-].*$/, '').trim();
    const image = pickBestArticleImage({
      image: pickMetaContent(html, 'og:image') || pickMetaContent(html, 'twitter:image'),
      content: html.slice(0, 40000),
      url
    });
    const snippet = pickMetaContent(html, 'og:description') || pickMetaContent(html, 'description');
    const siteName = pickMetaContent(html, 'og:site_name');
    if (!title && !image && !snippet) return null;
    return { title, image_url: image, snippet, site_name: siteName };
  } catch (e) {
    return null;
  }
}
