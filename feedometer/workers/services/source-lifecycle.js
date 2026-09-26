/**
 * Source lifecycle is intentionally separate from sources.status so the
 * existing production schema and legacy reader queries remain compatible.
 */
export const SOURCE_LIFECYCLE_STATES = Object.freeze([
  'pending', 'active', 'paused', 'degraded', 'failing', 'blocked'
]);

const DEGRADED_AFTER_FAILURES = 3;
const FAILING_AFTER_FAILURES = 6;
const BLOCKED_HTTP_STATUSES = new Set([401, 403, 451]);

export function nextRetryDelayMs(consecutiveFailures) {
  const failures = Math.max(1, Number(consecutiveFailures) || 1);
  // 5m, 10m, 20m, 40m, 80m, then cap at four hours.
  return Math.min(5 * 60 * 1000 * (2 ** (failures - 1)), 4 * 60 * 60 * 1000);
}

export function resolveLifecycleAfterFetch(current = {}, metrics = {}, now = Date.now()) {
  const paused = Boolean(current.is_user_paused);
  const priorFailures = Math.max(0, Number(current.consecutive_failures) || 0);
  const httpStatus = Number(metrics.httpStatus) || 0;

  if (paused) {
    return {
      state: 'paused', isUserPaused: true, consecutiveFailures: priorFailures,
      nextRetryAt: null, reason: 'Paused by user', errorCode: null, errorMessage: null,
      lastSuccessAt: metrics.isSuccess ? now : current.last_success_at || null,
      lastFailureAt: metrics.isSuccess ? current.last_failure_at || null : now
    };
  }

  if (metrics.isSuccess) {
    return {
      state: 'active', isUserPaused: false, consecutiveFailures: 0,
      nextRetryAt: null, reason: 'Last fetch succeeded', errorCode: null, errorMessage: null,
      lastSuccessAt: now, lastFailureAt: current.last_failure_at || null
    };
  }

  const failures = priorFailures + 1;
  const blocked = BLOCKED_HTTP_STATUSES.has(httpStatus);
  const state = blocked ? 'blocked' : (failures >= FAILING_AFTER_FAILURES ? 'failing' : (failures >= DEGRADED_AFTER_FAILURES ? 'degraded' : 'pending'));
  const reason = blocked
    ? `Upstream access blocked (HTTP ${httpStatus})`
    : `Fetch failed ${failures} time${failures === 1 ? '' : 's'}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`;
  return {
    state, isUserPaused: false, consecutiveFailures: failures,
    nextRetryAt: now + nextRetryDelayMs(failures), reason,
    errorCode: httpStatus ? `HTTP_${httpStatus}` : 'FETCH_FAILED',
    errorMessage: String(metrics.errorMessage || '').slice(0, 1000) || null,
    lastSuccessAt: current.last_success_at || null, lastFailureAt: now
  };
}

export async function ensureSourceLifecycle(env, sourceId, initialState = 'pending') {
  if (!env?.DB || !sourceId) return null;
  const now = Date.now();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO source_lifecycle (
      source_id, state, is_user_paused, consecutive_failures,
      state_reason, state_changed_at, created_at, updated_at
    ) VALUES (?, ?, 0, 0, 'Awaiting first fetch', ?, ?, ?)
  `).bind(sourceId, initialState, now, now, now).run();
  return env.DB.prepare('SELECT * FROM source_lifecycle WHERE source_id = ?').bind(sourceId).first();
}

export async function recordSourceFetchLifecycle(env, sourceId, metrics = {}) {
  if (!env?.DB || !sourceId || metrics.fromCache) return null;
  const now = Date.now();
  const current = await ensureSourceLifecycle(env, sourceId);
  if (!current) return null;
  const next = resolveLifecycleAfterFetch(current, metrics, now);
  const stateChanged = current.state !== next.state;
  await env.DB.prepare(`
    UPDATE source_lifecycle
    SET state = ?, is_user_paused = ?, consecutive_failures = ?,
        last_attempt_at = ?, last_success_at = ?, last_failure_at = ?,
        next_retry_at = ?, last_error_code = ?, last_error_message = ?,
        state_reason = ?, state_changed_at = CASE WHEN ? THEN ? ELSE state_changed_at END,
        updated_at = ?
    WHERE source_id = ?
  `).bind(
    next.state, next.isUserPaused ? 1 : 0, next.consecutiveFailures,
    now, next.lastSuccessAt, next.lastFailureAt,
    next.nextRetryAt, next.errorCode, next.errorMessage,
    next.reason, stateChanged ? 1 : 0, now, now, sourceId
  ).run();
  return Object.assign({ sourceId, lastAttemptAt: now }, next);
}

export async function setSourcePaused(env, sourceId, paused) {
  if (!env?.DB || !sourceId) return null;
  const now = Date.now();
  const current = await ensureSourceLifecycle(env, sourceId);
  if (!current) return null;
  const state = paused ? 'paused' : 'pending';
  const reason = paused ? 'Paused by user' : 'Resumed by user; awaiting next fetch';
  await env.DB.prepare(`
    UPDATE source_lifecycle
    SET state = ?, is_user_paused = ?, next_retry_at = ?, state_reason = ?,
        state_changed_at = ?, updated_at = ?
    WHERE source_id = ?
  `).bind(state, paused ? 1 : 0, paused ? null : now, reason, now, now, sourceId).run();
  return { sourceId, state, isUserPaused: Boolean(paused), reason };
}
