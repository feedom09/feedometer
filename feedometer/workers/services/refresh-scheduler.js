/** Query and policy helpers for the scheduled source refresh loop. */

export function isSourceRefreshEligible(lifecycle = {}, now = Date.now()) {
  if (Boolean(lifecycle.is_user_paused)) return false;
  if (lifecycle.state === 'paused' || lifecycle.state === 'blocked') return false;
  return !lifecycle.next_retry_at || Number(lifecycle.next_retry_at) <= now;
}

export function dueSourcesQuery() {
  return `
    SELECT s.id, s.title, s.feed_url, s.website_url, s.category, s.logo_url
    FROM sources s
    LEFT JOIN source_lifecycle sl ON sl.source_id = s.id
    WHERE s.status = 'active'
      AND s.feed_url IS NOT NULL
      AND TRIM(s.feed_url) != ''
      AND COALESCE(sl.is_user_paused, 0) = 0
      AND COALESCE(sl.state, 'pending') NOT IN ('paused', 'blocked')
      AND (sl.next_retry_at IS NULL OR sl.next_retry_at <= ?)
    ORDER BY
      CASE WHEN sl.next_retry_at IS NOT NULL THEN 0 ELSE 1 END,
      COALESCE(s.last_polled_at, 0) ASC
    LIMIT ?
  `;
}
