-- ==============================================================================
-- FEEDOMETER 2.1 — ENTERPRISE IDENTITY & CONTENT PLATFORM (CLOUDFLARE D1)
-- Target Database: feedometer-db
-- ==============================================================================

-- 1. DROP EXISTING TABLES IN REVERSE DEPENDENCY ORDER
DROP TABLE IF EXISTS article_events;
DROP TABLE IF EXISTS feed_submissions;
DROP TABLE IF EXISTS read_history;
DROP TABLE IF EXISTS saved_articles;
DROP TABLE IF EXISTS starred_articles;
DROP TABLE IF EXISTS user_feed_assignments;
DROP TABLE IF EXISTS user_feeds;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS articles;
DROP TABLE IF EXISTS source_health;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS publishers;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS user_audit_logs;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS user_passwords;
DROP TABLE IF EXISTS user_auth_providers;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS notify_signups;

-- ==============================================================================
-- DOMAIN 1: CORE IDENTITY & PROFILE
-- ==============================================================================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  email_verified INTEGER DEFAULT 0 CHECK(email_verified IN (0, 1)),
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  dob TEXT,
  dob_locked INTEGER DEFAULT 0 CHECK(dob_locked IN (0, 1)),
  avatar_url TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  last_login INTEGER,
  deleted_at INTEGER,
  plan TEXT DEFAULT 'free' CHECK(plan IN ('free', 'pro', 'premium'))
);

-- ==============================================================================
-- DOMAIN 2: PLUGGABLE AUTH PROVIDERS (Google, Apple, Microsoft, GitHub)
-- ==============================================================================
CREATE TABLE user_auth_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google', 'apple', 'github', 'microsoft', 'saml')),
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  provider_metadata TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 3: PASSWORD MANAGEMENT & BRUTE-FORCE LOCKOUT
-- ==============================================================================
CREATE TABLE user_passwords (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_changed_at INTEGER NOT NULL,
  failed_attempts INTEGER DEFAULT 0,
  locked_until INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 4: MULTI-DEVICE SESSIONS & DEVICE MANAGEMENT
-- ==============================================================================
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  device_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 5: EMAIL VERIFICATION TOKENS
-- ==============================================================================
CREATE TABLE email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0 CHECK(used IN (0, 1)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 6: PASSWORD RESET TOKENS
-- ==============================================================================
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0 CHECK(used IN (0, 1)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 7: ENTERPRISE AUDIT & COMPLIANCE LOGS
-- ==============================================================================
CREATE TABLE user_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ==============================================================================
-- DOMAIN 8: USER PREFERENCES & EXPERIENCE
-- ==============================================================================
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY,
  theme TEXT DEFAULT 'system' CHECK(theme IN ('light', 'dark', 'system')),
  reading_mode TEXT DEFAULT 'cards' CHECK(reading_mode IN ('cards', 'split', 'compact')),
  font_size TEXT DEFAULT 'medium' CHECK(font_size IN ('small', 'medium', 'large')),
  default_view TEXT DEFAULT 'home',
  timezone TEXT DEFAULT 'UTC',
  language TEXT DEFAULT 'en',
  date_format TEXT DEFAULT 'YYYY-MM-DD',
  email_notifications INTEGER DEFAULT 1 CHECK(email_notifications IN (0, 1)),
  auto_mark_read INTEGER DEFAULT 0 CHECK(auto_mark_read IN (0, 1)),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE notify_signups (
  email TEXT PRIMARY KEY,
  joined_at TEXT NOT NULL,
  source TEXT,
  country TEXT,
  city TEXT,
  synced_at TEXT NOT NULL
);

-- ==============================================================================
-- DOMAIN 9: PUBLISHERS, SOURCES & CATALOG
-- ==============================================================================
CREATE TABLE publishers (
  domain TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  bg_color TEXT,
  description TEXT,
  logo_url TEXT,
  is_popular INTEGER DEFAULT 0 CHECK(is_popular IN (0, 1)),
  popularity_rank INTEGER
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  publisher_domain TEXT,
  title TEXT NOT NULL,
  feed_url TEXT UNIQUE NOT NULL,
  website_url TEXT,
  source_type TEXT DEFAULT 'rss' CHECK(source_type IN ('rss', 'atom', 'youtube', 'reddit', 'amazon_deals', 'podcast', 'substack', 'custom')),
  feed_config TEXT,
  category TEXT DEFAULT 'general',
  language TEXT DEFAULT 'en',
  logo_url TEXT,
  is_verified INTEGER DEFAULT 0 CHECK(is_verified IN (0, 1)),
  article_count INTEGER DEFAULT 0,
  last_polled_at INTEGER,
  last_article_at INTEGER,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'failing')),
  FOREIGN KEY (publisher_domain) REFERENCES publishers(domain) ON DELETE SET NULL
);

CREATE TABLE source_health (
  source_id TEXT PRIMARY KEY,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  consecutive_failures INTEGER DEFAULT 0,
  last_http_status INTEGER,
  response_ms INTEGER,
  error_message TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE feed_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  feed_url TEXT NOT NULL,
  suggested_title TEXT,
  suggested_category TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_at INTEGER,
  reviewed_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ==============================================================================
-- DOMAIN 10: NORMALIZED CONTENT CATALOG
-- ==============================================================================
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  canonical_url_hash TEXT UNIQUE NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  snippet TEXT,
  content TEXT,
  image_url TEXT,
  published_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  is_pinned INTEGER DEFAULT 0 CHECK(is_pinned IN (0, 1)),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 11: HIERARCHICAL TAXONOMY & SUBSCRIPTIONS
-- ==============================================================================
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_folder_id TEXT,
  icon TEXT DEFAULT '📁',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE user_feeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  followed_at INTEGER NOT NULL,
  UNIQUE(user_id, source_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE user_feed_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  UNIQUE(user_id, feed_id, folder_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 12: NORMALIZED USER ACTIONS (POINTERS ONLY)
-- ==============================================================================
CREATE TABLE starred_articles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  starred_at INTEGER NOT NULL,
  UNIQUE(user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE saved_articles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  UNIQUE(user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE read_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  UNIQUE(user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- ==============================================================================
-- DOMAIN 13: TELEMETRY & ENGAGEMENT ANALYTICS
-- ==============================================================================
CREATE TABLE article_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  source_id TEXT,
  article_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('VIEW', 'CLICK', 'READ_COMPLETE', 'STAR', 'SAVE', 'SHARE', 'OPEN_SOURCE')),
  dwell_time_ms INTEGER,
  ip_address TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- ==============================================================================
-- COVERING B-TREE INDEXES
-- ==============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_providers_lookup ON user_auth_providers(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_providers_user ON user_auth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON user_audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sources_category ON sources(category);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);
CREATE INDEX IF NOT EXISTS idx_sources_publisher ON sources(publisher_domain);

CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_hash ON articles(canonical_url_hash);

CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_user_feeds_user ON user_feeds(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON user_feed_assignments(user_id, folder_id);

CREATE INDEX IF NOT EXISTS idx_starred_user ON starred_articles(user_id, starred_at DESC);
CREATE INDEX IF NOT EXISTS idx_starred_article ON starred_articles(article_id);

CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_articles(user_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_article ON saved_articles(article_id);

CREATE INDEX IF NOT EXISTS idx_read_user ON read_history(user_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_source ON article_events(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_article ON article_events(article_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_user ON article_events(user_id, created_at DESC);

-- ==============================================================================
-- DOMAIN 14: INTERNET-SCALE FEED DISCOVERY & TOPIC GRAPH
-- ==============================================================================
CREATE TABLE IF NOT EXISTS feed_discovery_cache (
  normalized_query TEXT PRIMARY KEY,
  results_json TEXT NOT NULL,
  total_sources_found INTEGER DEFAULT 0,
  total_articles_found INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS discovered_sources (
  id TEXT PRIMARY KEY,
  query_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  site_url TEXT NOT NULL,
  feed_url TEXT UNIQUE NOT NULL,
  feed_type TEXT NOT NULL CHECK(feed_type IN ('rss', 'atom', 'substack', 'youtube', 'podcast', 'research')),
  category TEXT,
  publisher_name TEXT,
  authority_score INTEGER DEFAULT 50,
  publishing_frequency REAL DEFAULT 1.0,
  feed_health_pct REAL DEFAULT 100.0,
  subscriber_count INTEGER DEFAULT 0,
  discovery_score REAL DEFAULT 0.5,
  discovery_layer INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_recommendations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  recommended_source_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN ('co_subscription', 'citation', 'same_topic', 'semantic_neighbor')),
  weight REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  UNIQUE(source_id, recommended_source_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_discovery_cache_expires ON feed_discovery_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_discovered_sources_query ON discovered_sources(query_key, discovery_score DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_sources_type ON discovered_sources(feed_type);
CREATE INDEX IF NOT EXISTS idx_source_rec_source ON source_recommendations(source_id, weight DESC);

-- ==============================================================================
-- DOMAIN 15: SEARCH, ALERTS, FILTERS (additive — do not drop existing tables)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  search_query TEXT NOT NULL,
  filters_json TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS keyword_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  notification_channel TEXT DEFAULT 'in_app',
  last_notified_at INTEGER,
  match_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_filter_rules (
  user_id TEXT PRIMARY KEY,
  rules_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS search_suggestions (
  term TEXT PRIMARY KEY,
  search_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS search_queries (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_clicks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  article_id TEXT,
  query TEXT,
  created_at INTEGER NOT NULL
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
