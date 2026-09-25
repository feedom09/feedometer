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
CREATE INDEX IF NOT EXISTS idx_user_integrations_status ON user_integrations(status);

INSERT OR IGNORE INTO integrations (id, code, name, category, icon, description, badge, setup_type, display_order, created_at) VALUES
('int_slack', 'slack', 'Slack', 'communication', '💬', 'Deliver real-time breaking alerts and scheduled daily briefings natively into your Slack channels using Block Kit cards.', 'Popular', 'webhook', 1, 1790000000000),
('int_teams', 'teams', 'Microsoft Teams', 'communication', '🟣', 'Send interactive Adaptive Cards to your Microsoft Teams channels via Power Automate Workflow webhooks.', 'Popular', 'webhook', 2, 1790000000000),
('int_discord', 'discord', 'Discord', 'communication', '🎮', 'Post rich news embeds directly into community servers and announcement channels.', 'Coming Soon', 'webhook', 3, 1790000000000),
('int_telegram', 'telegram', 'Telegram', 'communication', '✈️', 'Broadcast filtered feed matches and executive summaries to Telegram channels and bots.', 'Coming Soon', 'bot', 4, 1790000000000),
('int_zapier', 'zapier', 'Zapier', 'automation', '⚡', 'Connect FeedOmeter triggers to 5,000+ apps and trigger multi-step Zaps on new stories.', 'Popular', 'api_key', 5, 1790000000000),
('int_make', 'make', 'Make (Integromat)', 'automation', '🟣', 'Build visual automation scenarios connecting FeedOmeter syndicated articles to your CRM or data lake.', '', 'api_key', 6, 1790000000000),
('int_n8n', 'n8n', 'n8n', 'automation', '🔄', 'Fair-code workflow automation tool. Ingest FeedOmeter payloads into self-hosted nodes.', '', 'webhook', 7, 1790000000000),
('int_notion', 'notion', 'Notion', 'productivity', '📝', 'Automatically append matched intelligence articles and summaries into your team Notion databases.', 'Coming Soon', 'oauth', 8, 1790000000000),
('int_airtable', 'airtable', 'Airtable', 'productivity', '📊', 'Sync structured feed records, sentiment tags, and metadata into Airtable bases.', 'Coming Soon', 'api_key', 9, 1790000000000),
('int_webhook', 'webhook', 'Custom Webhook', 'developer', '⚡', 'Deliver signed HMAC-SHA256 JSON payloads directly to your custom HTTP POST backend endpoints.', 'Developer', 'webhook', 10, 1790000000000),
('int_api', 'api', 'FeedOmeter REST API', 'developer', '🔑', 'Full REST API access to search catalog, poll sources, and fetch structured articles programmatically.', 'Developer', 'api_key', 11, 1790000000000);
