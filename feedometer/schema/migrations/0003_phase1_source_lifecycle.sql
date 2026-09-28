-- Phase 1: additive source lifecycle state. Keep sources.status unchanged
-- for backward compatibility with existing reader and scheduler queries.
CREATE TABLE IF NOT EXISTS source_lifecycle (
  source_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'active', 'paused', 'degraded', 'failing', 'blocked')),
  is_user_paused INTEGER NOT NULL DEFAULT 0 CHECK(is_user_paused IN (0, 1)),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  next_retry_at INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  state_reason TEXT,
  state_changed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_lifecycle_state_retry
ON source_lifecycle(state, is_user_paused, next_retry_at);

-- Existing active sources remain active until their next observed fetch result.
INSERT OR IGNORE INTO source_lifecycle (
  source_id, state, is_user_paused, consecutive_failures,
  state_reason, state_changed_at, created_at, updated_at
)
SELECT
  id,
  CASE status WHEN 'paused' THEN 'paused' WHEN 'failing' THEN 'failing' ELSE 'active' END,
  CASE WHEN status = 'paused' THEN 1 ELSE 0 END,
  0,
  'Initial lifecycle backfill', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000
FROM sources;
