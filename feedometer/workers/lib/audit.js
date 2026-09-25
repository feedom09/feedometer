/**
 * workers/lib/audit.js — Audit Logging & Client Telemetry Helper
 * Cloudflare D1 Relational Engine
 */
import { generateRandomHex } from './crypto.js';

export function getClientInfo(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '127.0.0.1';
  const ua = request.headers.get('User-Agent') || 'Unknown Browser';

  let device = 'Desktop Device';
  if (/iPhone|iPad|iPod/i.test(ua)) device = 'Apple iOS Device';
  else if (/Android/i.test(ua)) device = 'Android Device';
  else if (/Windows/i.test(ua)) device = 'Windows PC';
  else if (/Macintosh|Mac OS/i.test(ua)) device = 'Apple Mac';
  else if (/Linux/i.test(ua)) device = 'Linux Machine';

  return { ip, ua, device };
}

export async function logAudit(env, userId, eventType, details, request) {
  if (!env.DB) return;
  try {
    const auditId = `aud_${generateRandomHex(12)}`;
    const { ip, ua } = request ? getClientInfo(request) : { ip: 'system', ua: 'system' };
    const now = Date.now();
    const metaStr = typeof details === 'string' ? details : JSON.stringify(details || {});
    // `user_audit_log` and its `details` column are the deployed D1 schema.
    // Keep this centralized so security events never fail silently because a
    // caller used an outdated pluralized table/column name.
    await env.DB.prepare(`
      INSERT INTO user_audit_log (id, user_id, event_type, ip_address, user_agent, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(auditId, userId, eventType, ip, ua, metaStr, now).run();
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}
