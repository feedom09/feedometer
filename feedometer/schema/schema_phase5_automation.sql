-- ==============================================================================
-- FEEDOMETER PHASE 5 — AUTOMATION ENGINE DDL (ADDITIVE MIGRATION)
-- Target Database: feedometer-db (Cloudflare D1 / SQLite)
-- Purpose: Alerts + Webhooks + Digests with Distributed Locking & Cursors
-- ==============================================================================

-- 1. GENERIC FEED EVENT QUEUE (Event Ingestion Stage)
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

CREATE INDEX IF NOT EXISTS idx_feed_events_queue 
ON feed_events(status, locked_until, created_at);


-- 2. USER ALERTS & OUTBOX DELIVERY QUEUE (Alerting Stage)
CREATE TABLE IF NOT EXISTS user_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  alert_type TEXT DEFAULT 'keyword' CHECK(alert_type IN ('keyword', 'collection', 'source', 'saved_search')),
  config_json TEXT NOT NULL,
  delivery_channels TEXT NOT NULL, -- JSON array: ["in_app", "push", "email"]
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
  FOREIGN KEY (alert_id) REFERENCES user_alerts(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerts_user 
ON user_alerts(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_queue 
ON alert_deliveries(status, locked_until, created_at);


-- 3. WEB PUSH SUBSCRIPTIONS
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

CREATE INDEX IF NOT EXISTS idx_push_user 
ON user_push_subscriptions(user_id);


-- 4. OUTBOUND WEBHOOKS & DELIVERY OUTBOX QUEUE (Webhook Stage)
CREATE TABLE IF NOT EXISTS user_webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  config_json TEXT, -- Optional JSON filter criteria
  cadence TEXT DEFAULT 'realtime' CHECK(cadence IN ('realtime', 'daily', 'weekly')),
  schedule_time TEXT DEFAULT '17:00',
  schedule_day TEXT DEFAULT 'monday',
  format_type TEXT DEFAULT 'standard' CHECK(format_type IN ('standard', 'slack')),
  last_cursor_at INTEGER DEFAULT 0,
  next_run_at INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt_count INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0,
  response_code INTEGER,
  response_body TEXT,
  duration_ms INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (webhook_id) REFERENCES user_webhooks(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhooks_user 
ON user_webhooks(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_queue 
ON webhook_deliveries(status, locked_until, created_at);


-- 5. SCHEDULED DIGESTS & RUN LEDGER (Digest Stage)
CREATE TABLE IF NOT EXISTS user_digests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('daily', 'weekly')),
  delivery_channel TEXT DEFAULT 'email' CHECK(delivery_channel IN ('email', 'in_app')),
  collection_ids TEXT, -- JSON array of folder/collection IDs
  config_json TEXT,    -- Optional JSON filter rules
  last_article_at INTEGER DEFAULT 0, -- High-water mark cursor
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

CREATE INDEX IF NOT EXISTS idx_digest_schedule 
ON user_digests(is_active, next_run_at);

CREATE INDEX IF NOT EXISTS idx_digest_runs 
ON digest_runs(digest_id, started_at DESC);
