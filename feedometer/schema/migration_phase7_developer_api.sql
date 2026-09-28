-- ==============================================================================
-- FEEDOMETER PHASE 7 — DEVELOPER REST API & API KEYS DDL
-- Target Database: feedometer-db (Cloudflare D1 / SQLite)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,         -- e.g. "fom_live_a1b2"
  key_suffix TEXT NOT NULL,         -- e.g. "9f3e1b7c"
  key_hash TEXT NOT NULL UNIQUE,    -- SHA-256 hash of full secret key
  permissions TEXT NOT NULL DEFAULT '["read:articles","read:sources","read:search","read:me"]',
  rate_limit_per_min INTEGER DEFAULT 60,
  last_used_at INTEGER,
  expires_at INTEGER,               -- Unix timestamp in ms (NULL = Never expires)
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_lookup ON api_keys(key_hash, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, is_active);
