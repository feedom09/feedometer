CREATE TABLE IF NOT EXISTS ai_article_summaries (
  article_id TEXT PRIMARY KEY, model TEXT NOT NULL, summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_topic_clusters (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, fingerprint TEXT UNIQUE NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_tracking_rules (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, entities_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
