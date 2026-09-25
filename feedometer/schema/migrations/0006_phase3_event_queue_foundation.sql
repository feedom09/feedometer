-- Phase 3 event queue dependencies for local webhook matching.
-- This is intentionally separate from 0005 because 0005 is already applied.

CREATE TABLE IF NOT EXISTS feed_events (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT DEFAULT 'ARTICLE_INGESTED',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  locked_until INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feed_events_queue ON feed_events(status, locked_until, created_at);

CREATE TABLE IF NOT EXISTS user_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  alert_type TEXT DEFAULT 'keyword' CHECK(alert_type IN ('keyword', 'collection', 'source', 'saved_search')),
  config_json TEXT NOT NULL,
  delivery_channels TEXT NOT NULL,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('in_app', 'push', 'email', 'telegram')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0,
  sent_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (alert_id) REFERENCES user_alerts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON user_alerts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_queue ON alert_deliveries(status, locked_until, created_at);
