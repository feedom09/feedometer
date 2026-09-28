/**
 * FeedOmeter edge services.
 *
 * SQL Server remains the system of record. This Worker only provides cache,
 * rendering, AI, scheduled refresh, and delivery capabilities; it has no D1
 * binding and never persists application data itself.
 */

const CACHE_TTL_SECONDS = 900;
const INTERNAL_SECRET_HEADER = 'x-feedom-internal-secret';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }
  });
}

function isInternal(request, env) {
  return Boolean(env.INTERNAL_EDGE_SECRET) && request.headers.get(INTERNAL_SECRET_HEADER) === env.INTERNAL_EDGE_SECRET;
}

async function fetchFeed(request, env, url) {
  if (!/^https?:\/\//i.test(url || '')) return json({ success: false, message: 'A valid HTTP(S) URL is required.' }, 400);
  const key = `feed:v1:${url}`;
  const cached = await env.FEEDS_KV.get(key, 'text');
  if (cached) return new Response(cached, { headers: { 'content-type': 'application/xml; charset=utf-8', 'x-feedom-cache': 'hit', 'access-control-allow-origin': '*' } });
  const upstream = await fetch(url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8' } });
  const body = await upstream.text();
  if (!upstream.ok || !/(<rss|<feed|<channel|<item|<entry)/i.test(body)) return json({ success: false, message: 'Upstream did not return a valid feed.' }, 422);
  await env.FEEDS_KV.put(key, body, { expirationTtl: CACHE_TTL_SECONDS });
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'x-feedom-cache': 'miss', 'access-control-allow-origin': '*' } });
}

async function sendEmail(request, env) {
  if (!isInternal(request, env)) return json({ success: false, message: 'Unauthorized' }, 401);
  if (!env.RESEND_API_KEY) return json({ success: false, message: 'Resend is not configured.' }, 503);
  const { to, subject, text, html } = await request.json();
  if (!to || !subject) return json({ success: false, message: 'to and subject are required.' }, 400);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: Array.isArray(to) ? to : [to], subject, text: text || '', ...(html ? { html } : {}) })
  });
  const result = await response.json().catch(() => ({}));
  return json({ success: response.ok, id: result.id || null, message: response.ok ? 'Email accepted.' : 'Email provider rejected the request.' }, response.ok ? 200 : 502);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': `content-type, ${INTERNAL_SECRET_HEADER}`, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ status: 'online', service: 'feedom-edge', dependencies: { database: 'sql-server-external', cache: env.FEEDS_KV ? 'configured' : 'unavailable', browser_rendering: env.BROWSER ? 'configured' : 'unavailable', ai: env.AI ? 'configured' : 'unavailable', email: env.RESEND_API_KEY ? 'configured' : 'unavailable' } });
    if (url.pathname === '/api/edge/feed' && request.method === 'GET') return fetchFeed(request, env, url.searchParams.get('url'));
    if (url.pathname === '/api/edge/email' && request.method === 'POST') return sendEmail(request, env);
    return json({ success: false, message: 'Not found' }, 404);
  },
  async scheduled(event, env, ctx) {
    if (!env.SQL_API_ORIGIN || !env.INTERNAL_EDGE_SECRET) return;
    ctx.waitUntil(fetch(`${env.SQL_API_ORIGIN.replace(/\/$/, '')}/api/internal/refresh`, { method: 'POST', headers: { [INTERNAL_SECRET_HEADER]: env.INTERNAL_EDGE_SECRET } }));
  }
};
