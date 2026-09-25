/**
 * workers/services/builder-static-fetch.js — HTTP fetch fallbacks for Visual Builder
 */

export const PROXY_FETCH_MS = 35000;

function buildProxyFetchHeaders(pageUrl) {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
}

function buildProxyMobileHeaders(pageUrl) {
  return {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none'
  };
}

async function fetchPageHtmlForProxy(url, headers) {
  return fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(PROXY_FETCH_MS)
  });
}

export async function fetchProxyHtmlWithFallbacks(url) {
  const attempts = [
    { headers: buildProxyFetchHeaders(url) },
    { headers: buildProxyMobileHeaders(url) }
  ];

  let lastStatus = 0;
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const res = await fetchPageHtmlForProxy(url, attempt.headers);
      lastStatus = res.status;
      if (res.ok) {
        const html = await res.text();
        return { ok: true, status: res.status, html, finalUrl: res.url || url };
      }
      if (res.status === 403 || res.status === 429 || res.status === 503) {
        continue;
      }
      lastError = new Error(`Failed to load website. Server responded with HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (err && err.name === 'TimeoutError') {
        lastError = new Error(
          `Timed out after ${Math.round(PROXY_FETCH_MS / 1000)}s while fetching the website. Try again or use a lighter page.`
        );
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error(`Failed to load website. Server responded with HTTP ${lastStatus || 502}`);
}

export function detectLikelyJsShell(html) {
  const sample = String(html || '');
  const hasArticleSignals = /<(article|main|h1|h2|h3)\b/i.test(sample);
  if (hasArticleSignals) return false;

  const scriptCount = (sample.match(/<script\b/gi) || []).length;
  if (sample.length < 1200 && scriptCount > 0) return true;
  if (/__NEXT_DATA__|window\.__NUXT__|id=["']root["']/i.test(sample)) return true;
  if (scriptCount >= 8) return true;
  return false;
}

/** Prefer browser render for known SPA/dynamic layouts — NOT for Akamai-hard sites like Sky */
const BROWSER_FIRST_HOSTS = [
  /(?:^|\.)theverge\.com$/i,
  /(?:^|\.)wired\.com$/i
];

export function preferBrowserRenderForUrl(targetUrl) {
  try {
    let url = String(targetUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const host = new URL(url).hostname.replace(/^www\./i, '');
    if (/(?:^|\.)sky(?:sports)?\.com$/i.test(host)) return false;
    return BROWSER_FIRST_HOSTS.some((re) => re.test(host));
  } catch (_) {
    return false;
  }
}

export function detectHeavyDynamicLayout(html, targetUrl) {
  const sample = String(html || '');
  if (preferBrowserRenderForUrl(targetUrl)) return true;
  if (/__NEXT_DATA__|data-reactroot|ng-version=/i.test(sample) && detectLikelyJsShell(sample)) return true;
  return false;
}
