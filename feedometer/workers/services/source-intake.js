/** Safe, canonical intake validation for user-provided fetch targets. */
import { detectSourceType } from './source-detector.js';

const MAX_URL_LENGTH = 2048;
const PRIVATE_IPV4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.0\.0\./, /^192\.0\.2\./, /^192\.168\./, /^198\.18\./, /^198\.51\.100\./,
  /^203\.0\.113\./, /^224\./, /^2(2[4-9]|3\d|4\d|5[0-5])\./
];

function isUnsafeHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  return PRIVATE_IPV4.some(pattern => pattern.test(host));
}

export function normalizeExternalHttpUrl(rawUrl) {
  let raw = String(rawUrl || '').trim();
  if (!raw) return { ok: false, code: 'URL_REQUIRED', message: 'A source URL is required.' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, code: 'URL_TOO_LONG', message: `Source URLs must be ${MAX_URL_LENGTH} characters or fewer.` };
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch (_) { return { ok: false, code: 'INVALID_URL', message: 'Enter a valid HTTP or HTTPS URL.' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, code: 'UNSUPPORTED_PROTOCOL', message: 'Only HTTP and HTTPS source URLs are supported.' };
  if (url.username || url.password) return { ok: false, code: 'CREDENTIALS_NOT_ALLOWED', message: 'URLs containing credentials are not allowed.' };
  if (isUnsafeHost(url.hostname)) return { ok: false, code: 'PRIVATE_TARGET_BLOCKED', message: 'Local, private, and network-internal addresses cannot be used as feed sources.' };
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return { ok: true, url: url.toString() };
}

export function validateSourceInput(rawInput, options = {}) {
  const detected = detectSourceType(rawInput);
  const allowKeywords = Boolean(options.allowKeywords);
  if (detected.type === 'unknown') return { ok: false, code: 'INPUT_REQUIRED', message: 'Enter a feed URL, website URL, YouTube channel, Reddit community, or topic.' };
  if (detected.type === 'keyword') {
    if (!allowKeywords) return { ok: false, code: 'FEED_URL_REQUIRED', message: 'A feed or website URL is required here. Create topic monitoring from Find Feeds instead.' };
    return { ok: true, type: 'keyword', normalized: detected.query, detected };
  }
  const normalized = normalizeExternalHttpUrl(detected.normalized || rawInput);
  if (!normalized.ok) return normalized;
  return { ok: true, type: detected.type, normalized: normalized.url, detected };
}
