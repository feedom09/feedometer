-- Original roadmap Phase 4: durable search, curation, and health foundations.
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  search_query TEXT NOT NULL, filters_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_article_tags (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  color TEXT, created_at INTEGER NOT NULL, UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS article_tag_assignments (
  user_id TEXT NOT NULL, article_id TEXT NOT NULL, tag_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY(user_id, article_id, tag_id),
  FOREIGN KEY(tag_id) REFERENCES user_article_tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_article_tag_assignments_tag ON article_tag_assignments(user_id, tag_id, article_id);

CREATE TABLE IF NOT EXISTS user_collections (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, share_token TEXT UNIQUE, is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS collection_articles (
  collection_id TEXT NOT NULL, article_id TEXT NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY(collection_id, article_id),
  FOREIGN KEY(collection_id) REFERENCES user_collections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_health_metrics (
  source_id TEXT PRIMARY KEY, health_score INTEGER NOT NULL, field_health_json TEXT NOT NULL DEFAULT '{}',
  item_count_baseline INTEGER NOT NULL DEFAULT 0, last_item_count INTEGER NOT NULL DEFAULT 0,
  last_drift_detected_at INTEGER, last_healed_at INTEGER, recorded_at INTEGER NOT NULL,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);
