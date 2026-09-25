/**
 * workers/services/cache-manager.js — Multi-Tier Edge Cache & Health Telemetry Engine
 */
import { parseXmlFeed } from './rss-parser.js';
import { normalizeArticle } from './article-normalizer.js';
import { persistFetchedFeed } from './article-repository.js';

const FEEDOMETER_BOT_UA = 'Mozilla/5.0 (compatible; FeedometerBot/1.0; +https://feedometer.pages.dev)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchWithTimeout(url, headers, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isValidFeedXml(text) {
  if (!text || typeof text !== 'string' || text.length < 50) return false;
  const lower = text.toLowerCase();
  return lower.includes('<rss') || lower.includes('<feed') || lower.includes('<channel') || lower.includes('<item') || lower.includes('<entry');
}

/**
 * Executes Adaptive Upstream Fetch across 3 Tiers:
 * Tier 1: FeedometerBot Identity (whitelisted by major publishers/Akamai/ESPN)
 * Tier 2: Browser Profile with HTTPS Protocol Upgrade & Origin Referer (for Fastly/Cloudflare/Incapsula)
 * Tier 3: Resilient Public Gateway Fallback
 */
async function executeAdaptiveUpstreamFetch(rawUrl) {
  let targetUrl = (rawUrl || '').trim();
  let lastStatus = 0;
  let lastError = null;

  // 1. Tier 1: Primary FeedometerBot Identity
  try {
    const res1 = await fetchWithTimeout(targetUrl, {
      'User-Agent': FEEDOMETER_BOT_UA,
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }, 7000);

    lastStatus = res1.status;
    if (res1.ok && res1.status === 200) {
      const xml = await res1.text();
      if (isValidFeedXml(xml)) {
        return { xml, status: res1.status, tier: 1 };
      }
    }
  } catch (e) {
    lastError = e;
  }

  // 2. Tier 2: Browser Profile + HTTPS Protocol Upgrade + Origin Referer
  try {
    let httpsUrl = targetUrl;
    if (httpsUrl.startsWith('http://')) {
      httpsUrl = httpsUrl.replace('http://', 'https://');
    }
    let origin = '';
    try { origin = new URL(httpsUrl).origin; } catch (_) {}

    const res2 = await fetchWithTimeout(httpsUrl, {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': origin || httpsUrl,
      'Upgrade-Insecure-Requests': '1'
    }, 8000);

    lastStatus = res2.status;
    if (res2.ok && res2.status === 200) {
      const xml = await res2.text();
      if (isValidFeedXml(xml)) {
        return { xml, status: res2.status, tier: 2 };
      }
    }
  } catch (e) {
    lastError = e;
  }

  // 3. Tier 3: Resilient Public Gateways Fallback
  const bridges = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl),
    'https://corsproxy.io/?' + encodeURIComponent(targetUrl)
  ];
  for (const bridge of bridges) {
    try {
      const res3 = await fetchWithTimeout(bridge, { 'User-Agent': BROWSER_UA }, 6000);
      lastStatus = res3.status;
      if (res3.ok) {
        const xml = await res3.text();
        if (isValidFeedXml(xml)) {
          return { xml, status: res3.status, tier: 3 };
        }
      }
    } catch (_) {}
  }

  throw new Error(lastError ? lastError.message : `Upstream returned status ${lastStatus} without valid XML`);
}

function schedulePersist(env, ctx, source, payload, metrics) {
  if (!env || !env.DB || !ctx || typeof ctx.waitUntil !== 'function') return;
  ctx.waitUntil(
    persistFetchedFeed(env, source, payload, metrics).catch((err) => {
      console.warn('D1 feed persist failed:', err.message);
    })
  );
}

export async function fetchFeedWithCache(source, env, ctx, ttlSeconds = 900) {
  const cacheKey = `feed:${source.feed_url}`;
  const startTime = Date.now();
  let payload = null;
  let fromCache = false;
  let httpStatus = 0;
  let isSuccess = false;
  let errorMessage = null;

  if (env.FEEDS_KV) {
    try {
      const cached = await env.FEEDS_KV.get(cacheKey, 'json');
      if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
        payload = cached;
        fromCache = true;
        isSuccess = true;
      }
    } catch (e) {
      console.warn('KV read error:', e.message);
    }
  }

  if (!payload) {
    try {
      const { xml: xmlText, status: fetchStatus } = await executeAdaptiveUpstreamFetch(source.feed_url);
      httpStatus = fetchStatus;

      const parsed = parseXmlFeed(xmlText);
      const normalizedItems = [];
      for (const rawItem of (parsed.items || [])) {
        const norm = await normalizeArticle(rawItem, source);
        normalizedItems.push(norm);
      }

      payload = {
        source: {
          id: source.id,
          title: source.title || parsed.title || 'Feed Source',
          feed_url: source.feed_url,
          website_url: source.website_url || parsed.link || '',
          category: source.category || 'general',
          logo_url: source.logo_url || ''
        },
        items: normalizedItems,
        fetched_at: Date.now()
      };
      isSuccess = true;

      if (env.FEEDS_KV && ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(
          env.FEEDS_KV.put(cacheKey, JSON.stringify(payload), {
            expirationTtl: ttlSeconds
          }).catch((err) => console.error('KV write error:', err))
        );
      }
    } catch (err) {
      errorMessage = err.message;
      console.error(`Feed fetch failure for [${source.feed_url}]:`, err.message);
      payload = {
        source: {
          id: source.id,
          title: source.title || 'Feed Source',
          feed_url: source.feed_url
        },
        items: [],
        error: err.message,
        fetched_at: Date.now()
      };
    }
  }

  schedulePersist(env, ctx, source, payload, {
    fromCache,
    isSuccess,
    httpStatus,
    responseMs: Date.now() - startTime,
    errorMessage
  });

  return payload;
}
