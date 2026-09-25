-- Phase 3 local integration, webhook, and developer API foundation.
-- Additive only: safe to apply after the Phase 0/1 migration chain.

CREATE TABLE IF NOT EXISTS user_webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  config_json TEXT,
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
  FOREIGN KEY (webhook_id) REFERENCES user_webhooks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhooks_user ON user_webhooks(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_queue ON webhook_deliveries(status, locked_until, created_at);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  icon TEXT NOT NULL,
  logo_url TEXT,
  description TEXT NOT NULL,
  badge TEXT,
  setup_type TEXT DEFAULT 'webhook',
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  display_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'error')),
  last_used_at INTEGER,
  last_error TEXT,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (integration_id) REFERENCES integrations(id)
);

CREATE INDEX IF NOT EXISTS idx_user_integrations_user ON user_integrations(user_id, integration_id);

INSERT OR IGNORE INTO integrations (id, code, name, category, icon, description, badge, setup_type, display_order, created_at) VALUES
('int_slack', 'slack', 'Slack', 'communication', '💬', 'Deliver FeedOmeter alerts to Slack incoming webhooks.', 'Supported', 'webhook', 1, 1790000000000),
('int_teams', 'teams', 'Microsoft Teams', 'communication', '🟣', 'Deliver FeedOmeter alerts to Teams workflow webhooks.', 'Supported', 'webhook', 2, 1790000000000),
('int_webhook', 'webhook', 'Custom Webhook', 'developer', '⚡', 'Deliver signed FeedOmeter event envelopes to a custom HTTPS endpoint.', 'Supported', 'webhook', 3, 1790000000000),
('int_discord', 'discord', 'Discord', 'communication', '🎮', 'Planned provider-specific integration.', 'Coming Soon', 'webhook', 10, 1790000000000),
('int_notion', 'notion', 'Notion', 'productivity', '📝', 'Planned OAuth integration.', 'Coming Soon', 'oauth', 11, 1790000000000);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_suffix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '["read:articles","read:sources","read:search","read:me"]',
  rate_limit_per_min INTEGER DEFAULT 60,
  last_used_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_lookup ON api_keys(key_hash, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, is_active);
