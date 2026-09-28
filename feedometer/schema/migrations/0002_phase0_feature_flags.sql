-- Phase 0: database-backed feature flags for controlled rollout.
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK(is_enabled IN (0, 1)),
  description TEXT,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO feature_flags (key, is_enabled, description, updated_at)
VALUES ('phase0_local_first_migrations', 1, 'Schema changes are validated against local D1 before live application.', unixepoch() * 1000);
