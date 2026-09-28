-- Phase 5 automation tables not present in the earlier event-queue migration.
-- Additive only. External email and Web Push providers remain configuration-gated.

CREATE TABLE IF NOT EXISTS user_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_user ON user_push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS user_digests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('daily', 'weekly')),
  delivery_channel TEXT DEFAULT 'in_app' CHECK(delivery_channel IN ('email', 'in_app')),
  collection_ids TEXT,
  config_json TEXT,
  last_article_at INTEGER DEFAULT 0,
  last_run_at INTEGER,
  next_run_at INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digest_runs (
  id TEXT PRIMARY KEY,
  digest_id TEXT NOT NULL,
  article_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  sent_to TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  FOREIGN KEY (digest_id) REFERENCES user_digests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_digest_schedule ON user_digests(is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_digest_runs ON digest_runs(digest_id, started_at DESC);
