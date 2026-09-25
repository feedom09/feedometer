/**
 * workers/services/browser-render.js — Cloudflare Browser Rendering (Puppeteer)
 */
import puppeteer from '@cloudflare/puppeteer';

const RENDER_TIMEOUT_MS = 45000;
const RENDER_SETTLE_MS = 2500;

export function isBrowserRenderingAvailable(env) {
  return Boolean(env && env.BROWSER);
}

/**
 * Renders a URL in a headless browser and returns serialized HTML.
 */
export async function renderPageHtml(env, targetUrl, options = {}) {
  if (!isBrowserRenderingAvailable(env)) {
    throw new Error(
      'Browser Rendering is not configured. Enable Browser Rendering in Cloudflare and add a [browser] binding (BROWSER) in wrangler.toml, then redeploy.'
    );
  }

  let url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  const waitUntil = options.waitUntil || 'domcontentloaded';
  const timeout = options.timeout || RENDER_TIMEOUT_MS;

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.goto(url, { waitUntil, timeout });
    try {
      await page.evaluate(async () => {
        window.scrollTo(0, Math.min(document.body.scrollHeight, 2400));
        await new Promise((r) => setTimeout(r, 800));
        window.scrollTo(0, 0);
      });
    } catch (_) {}
    await new Promise((r) => setTimeout(r, RENDER_SETTLE_MS));
    return await page.content();
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
  }
}
