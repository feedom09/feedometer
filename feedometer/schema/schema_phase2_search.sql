-- Additive search / alerts / filters for existing feedometer-db
-- Run: wrangler d1 execute feedometer-db --file=schema/schema_phase2_search.sql --remote

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  search_query TEXT NOT NULL,
  filters_json TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS keyword_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  notification_channel TEXT DEFAULT 'in_app',
  last_notified_at INTEGER,
  match_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_filter_rules (
  user_id TEXT PRIMARY KEY,
  rules_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_suggestions (
  term TEXT PRIMARY KEY,
  search_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  updated_at INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
  article_id UNINDEXED,
  published_at UNINDEXED,
  language UNINDEXED,
  title,
  author,
  snippet,
  source_name,
  category
);
