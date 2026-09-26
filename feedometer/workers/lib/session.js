/**
 * workers/lib/session.js — Session Verification Middleware
 * Cloudflare D1 Relational Engine
 */
import { sha256Hex } from './crypto.js';

export async function verifySessionToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  let rawToken = '';

  if (authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  } else if (request.headers.get('X-Session-Token')) {
    rawToken = request.headers.get('X-Session-Token').trim();
  }

  if (!rawToken || !env.DB) return null;

  try {
    const tokenHash = await sha256Hex(rawToken);
    const now = Date.now();

    const sessionSql = `
      SELECT s.id as session_id, s.user_id, s.expires_at, s.device_name, s.ip_address,
             u.email, u.first_name, u.last_name, u.display_name, u.dob, u.dob_locked,
             u.avatar_url, u.email_verified, u.status, u.created_at
             {{plan}}
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
    `;
    let session;
    try {
      session = await env.DB.prepare(sessionSql.replace('{{plan}}', ', u.plan')).bind(tokenHash, now).first();
    } catch (planErr) {
      session = await env.DB.prepare(sessionSql.replace('{{plan}}', '')).bind(tokenHash, now).first();
    }

    if (!session) return null;

    // Refresh last_seen asynchronously
    env.DB.prepare('UPDATE user_sessions SET last_seen = ? WHERE id = ?').bind(now, session.session_id).run().catch(() => {});

    const displayName = session.display_name || session.first_name || session.email.split('@')[0];
    const avatarUrl = session.avatar_url || '';
    return {
      userId: session.user_id,
      email: session.email,
      sessionId: session.session_id,
      user: {
        id: session.user_id,
        email: session.email,
        email_verified: session.email_verified,
        first_name: session.first_name || '',
        last_name: session.last_name || '',
        display_name: displayName,
        name: displayName,
        dob: session.dob || '',
        dob_locked: session.dob_locked || 0,
        avatar_url: avatarUrl,
        picture: avatarUrl,
        created_at: session.created_at,
        plan: session.plan || 'free'
      }
    };
  } catch (e) {
    console.error('Session verification error:', e.message);
    return null;
  }
}
