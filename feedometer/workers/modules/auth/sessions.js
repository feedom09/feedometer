/**
 * workers/modules/auth/sessions.js — Session Listing, Revocation & Security Controls
 * Cloudflare D1 Relational Engine
 */
import { jsonResponse, errorResponse } from '../../lib/response.js';
import { logAudit } from '../../lib/audit.js';
import { verifySessionToken } from '../../lib/session.js';

export async function handleListSessions(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  try {
    const list = await env.DB.prepare(`
      SELECT id, ip_address, user_agent, device_name, created_at, expires_at, last_seen
      FROM user_sessions WHERE user_id = ? ORDER BY last_seen DESC
    `).bind(session.userId).all();

    const mapped = (list.results || []).map(s => ({
      ...s,
      is_current: s.id === session.sessionId
    }));

    return jsonResponse({ status: 'success', sessions: mapped });
  } catch (err) {
    return errorResponse('Failed to list sessions', 500);
  }
}

export async function handleRevokeSession(request, sessionId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  try {
    await env.DB.prepare('DELETE FROM user_sessions WHERE id = ? AND user_id = ?').bind(sessionId, session.userId).run();
    await logAudit(env, session.userId, 'SESSION_REVOKED', { sessionId }, request);
    return jsonResponse({ status: 'success', message: 'Session revoked' });
  } catch (err) {
    return errorResponse('Failed to revoke session', 500);
  }
}

export async function handleRevokeOtherSessions(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  try {
    await env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ? AND id != ?').bind(session.userId, session.sessionId).run();
    await logAudit(env, session.userId, 'OTHER_SESSIONS_REVOKED', {}, request);
    return jsonResponse({ status: 'success', message: 'All other sessions have been revoked' });
  } catch (err) {
    return errorResponse('Failed to revoke other sessions', 500);
  }
}
