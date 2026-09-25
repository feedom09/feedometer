/**
 * workers/services/builder-page-fetch.js — Static + browser HTML fetch for Visual Builder
 */
import {
  detectHeavyDynamicLayout,
  detectLikelyJsShell,
  fetchProxyHtmlWithFallbacks,
  preferBrowserRenderForUrl
} from './builder-static-fetch.js';
import { isBrowserRenderingAvailable, renderPageHtml } from './browser-render.js';

export function normalizeBuilderUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

/**
 * @param {'auto'|'static'|'browser'|string} mode
 */
export function normalizeRenderMode(mode) {
  const m = String(mode || 'auto').toLowerCase();
  if (m === 'static' || m === 'fast' || m === 'html') return 'static';
  if (m === 'browser' || m === 'full' || m === 'render' || m === 'js') return 'browser';
  return 'auto';
}

function cacheKeyForUrl(url) {
  return `builder_render_v1:${url}`;
}

/**
 * Fetches page HTML for builder proxy, evaluate, and live feeds.
 * @returns {Promise<{ html: string, finalUrl: string, renderEngine: 'static'|'browser', jsShell: boolean, browserSkipped?: boolean, cached?: boolean }>}
 */
export async function fetchPageHtmlForBuilder(env, targetUrl, options = {}) {
  const url = normalizeBuilderUrl(targetUrl);
  if (!url) {
    throw new Error('Missing target URL');
  }

  const renderMode = normalizeRenderMode(options.renderMode);
  const staticFetched = await fetchProxyHtmlWithFallbacks(url);
  let html = staticFetched.html;
  let renderEngine = 'static';
  let jsShell = detectLikelyJsShell(html);
  const heavyDynamic = detectHeavyDynamicLayout(html, url);

  const wantsBrowser =
    renderMode === 'browser' ||
    (renderMode === 'auto' && (jsShell || heavyDynamic || preferBrowserRenderForUrl(url)));

  if (!wantsBrowser) {
    return {
      html,
      finalUrl: staticFetched.finalUrl || url,
      renderEngine,
      jsShell
    };
  }

  if (!isBrowserRenderingAvailable(env)) {
    if (renderMode === 'browser') {
      throw new Error(
        'Full browser render was requested but Browser Rendering is not available on this worker.'
      );
    }
    return {
      html,
      finalUrl: staticFetched.finalUrl || url,
      renderEngine: 'static',
      jsShell,
      browserSkipped: true
    };
  }

  const kvKey = cacheKeyForUrl(url);
  if (env && env.FEEDS_KV) {
    try {
      const cached = await env.FEEDS_KV.get(kvKey);
      if (cached) {
        return {
          html: cached,
          finalUrl: staticFetched.finalUrl || url,
          renderEngine: 'browser',
          jsShell: detectLikelyJsShell(cached),
          cached: true
        };
      }
    } catch (_) {}
  }

  try {
    html = await renderPageHtml(env, url, options);
    renderEngine = 'browser';
    jsShell = detectLikelyJsShell(html);

    if (env && env.FEEDS_KV && html.length < 2800000) {
      try {
        await env.FEEDS_KV.put(kvKey, html, { expirationTtl: 900 });
      } catch (_) {}
    }
  } catch (err) {
    if (renderMode === 'browser') {
      throw err;
    }
    renderEngine = 'static';
  }

  return {
    html,
    finalUrl: staticFetched.finalUrl || url,
    renderEngine,
    jsShell,
    browserSkipped: renderEngine === 'static' && wantsBrowser
  };
}
