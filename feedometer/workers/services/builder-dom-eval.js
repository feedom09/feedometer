/**
 * workers/services/builder-dom-eval.js — DOM-based Visual Builder selector evaluation
 */
import { parseHTML } from 'linkedom';
import { decodeEntities } from './metadata-scraper.js';
import { looksLikeLowQualityImage } from './web-to-rss.js';

function cleanText(str) {
  if (!str) return '';
  return decodeEntities(str)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveUrl(relative, base) {
  try {
    return new URL(relative, base).href;
  } catch (_) {
    return relative;
  }
}

function resolveHttpUrl(relative, base) {
  try {
    const url = new URL(relative, base);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
  } catch (_) {
    return '';
  }
}

function safeQuery(root, selector) {
  if (!root || !selector || !String(selector).trim()) return null;
  try {
    return root.querySelector(String(selector).trim());
  } catch (_) {
    return null;
  }
}

function safeQueryAll(document, selector) {
  if (!document || !selector || !String(selector).trim()) return [];
  try {
    return Array.from(document.querySelectorAll(String(selector).trim()));
  } catch (_) {
    return [];
  }
}

function extractTitle(el) {
  if (!el) return '';
  return cleanText(el.textContent || '');
}

function extractLink(el, container, pageUrl, linkSel) {
  let node = el;
  if (!node && linkSel) {
    node = safeQuery(container, linkSel);
  }
  if (!node) {
    node = container.querySelector('a[href]');
  }
  if (!node) return '';

  const anchor = node.tagName === 'A' ? node : node.closest('a');
  const href = (anchor && anchor.getAttribute('href')) || node.getAttribute('href') || '';
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
  return resolveHttpUrl(href.trim(), pageUrl);
}

function parseBestSrcset(srcsetStr) {
  if (!srcsetStr || typeof srcsetStr !== 'string') return '';
  const candidates = srcsetStr.split(',').map((c) => {
    const parts = c.trim().split(/\s+/);
    const url = parts[0];
    let score = 1;
    if (parts[1]) {
      if (parts[1].endsWith('w')) score = parseInt(parts[1], 10) || 1;
      else if (parts[1].endsWith('x')) score = (parseFloat(parts[1]) || 1) * 500;
    }
    return { url, score };
  }).filter((c) => Boolean(c.url) && !c.url.startsWith('data:image/svg'));
  if (!candidates.length) return '';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
}

function extractImage(el, container, pageUrl, imageSel) {
  let node = el;
  if (!node && imageSel) {
    node = safeQuery(container, imageSel);
  }
  if (!node) {
    node = container.querySelector('img, picture source, [style*="background-image"]');
  }
  if (!node) return '';

  let rawSrc = '';

  // Check picture source tags
  const sourceEl = node.tagName === 'SOURCE' ? node : node.querySelector('source');
  if (sourceEl) {
    rawSrc = parseBestSrcset(sourceEl.getAttribute('srcset') || sourceEl.getAttribute('data-srcset') || '');
  }

  // Check img element if no source tag or if srcset was empty
  if (!rawSrc) {
    const img = node.tagName === 'IMG' ? node : node.querySelector('img');
    if (img) {
      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      const bestSrcset = parseBestSrcset(srcset);
      rawSrc =
        bestSrcset ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-lazy') ||
        img.getAttribute('data-image') ||
        img.getAttribute('data-hi-res') ||
        img.getAttribute('data-url') ||
        img.getAttribute('src') ||
        '';
    }
  }

  // Fallback to background-image style
  if (!rawSrc && node.getAttribute) {
    const style = node.getAttribute('style') || '';
    const bgMatch = style.match(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
      rawSrc = bgMatch[1];
    }
  }

  if (!rawSrc) return '';
  const resolved = resolveUrl(rawSrc.trim(), pageUrl);
  if (!resolved || looksLikeLowQualityImage(resolved)) return '';
  return resolved;
}

function extractDescription(el, container, descSel) {
  let node = el;
  if (!node && descSel) {
    node = safeQuery(container, descSel);
  }
  if (!node) {
    node = container.querySelector('p, .summary, .excerpt, [itemprop="description"]');
  }
  if (!node) return '';
  return cleanText(node.textContent || '').slice(0, 300);
}

function extractDate(el, container, dateSel) {
  let node = el;
  if (!node && dateSel) {
    node = safeQuery(container, dateSel);
  }
  if (!node) {
    node = container.querySelector('time, [itemprop="datePublished"], [data-timestamp], [data-time], .date, .published');
  }
  if (!node) return '';
  const dt =
    node.getAttribute('datetime') ||
    node.getAttribute('data-datetime') ||
    node.getAttribute('data-timestamp') ||
    node.getAttribute('data-time') ||
    node.getAttribute('data-pubdate') ||
    node.textContent ||
    '';
  return cleanText(dt);
}

function extractAuthor(el, container, authorSel) {
  if (!authorSel) return '';
  const node = el || safeQuery(container, authorSel);
  if (!node) return '';
  return cleanText(node.textContent || '');
}

/**
 * Evaluates selector config using linkedom querySelector/querySelectorAll
 */
export function evaluateSelectorConfigDom(html, pageUrl, config = {}) {
  const containerSel = config.itemContainer || config.container || 'article';
  const titleSel = config.title || 'h1, h2, h3, h4';
  const linkSel = config.link || 'a[href]';
  const descSel = config.description || 'p';
  const imageSel = config.image || 'img';
  const dateSel = config.date || 'time';
  const authorSel = config.author || '';

  const { document } = parseHTML(String(html || ''));
  const containers = safeQueryAll(document, containerSel).slice(0, 50);
  const items = [];

  for (const container of containers) {
    const titleEl = safeQuery(container, titleSel);
    const title = extractTitle(titleEl);
    const link = extractLink(null, container, pageUrl, linkSel);
    const description = extractDescription(null, container, descSel);
    const image = extractImage(null, container, pageUrl, imageSel);
    const pubDate = extractDate(null, container, dateSel);
    const author = extractAuthor(null, container, authorSel);

    // A saved recipe must identify real cards. Do not turn navigation, ad, or
    // empty elements into fabricated RSS entries.
    if (title.length < 3 || !link) continue;

    items.push({
      title: title.slice(0, 500),
      link,
      description: (description || title).slice(0, 2000),
      image,
      pubDate,
      author
    });
  }

  const dedupedItems = Array.from(new Map(items.map((item) => [item.link, item])).values());
  const total = dedupedItems.length || 1;
  const confidence = {
    title: Number((dedupedItems.filter((i) => i.title && i.title.length >= 3).length / total).toFixed(2)),
    link: Number((dedupedItems.filter((i) => i.link && /^https?:\/\//i.test(i.link)).length / total).toFixed(2)),
    image: Number((dedupedItems.filter((i) => Boolean(i.image)).length / total).toFixed(2)),
    date: Number((dedupedItems.filter((i) => Boolean(i.pubDate)).length / total).toFixed(2))
  };

  return {
    matchCount: dedupedItems.length,
    confidence,
    items: dedupedItems
  };
}
