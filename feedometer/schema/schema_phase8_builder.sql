-- ==============================================================================
-- FEEDOMETER PHASE 8 — VISUAL BUILDER, HEALTH SCORING & DOMAIN LEARNING
-- Target Database: feedometer-db (Cloudflare D1 / SQLite)
-- ==============================================================================

-- 1. VISUAL BUILDER CONFIGURATIONS & FALLBACK CHAINS
CREATE TABLE IF NOT EXISTS feed_builder_configs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  content_type TEXT DEFAULT 'news' CHECK(content_type IN ('news', 'blog', 'ecommerce', 'generic')),
  render_js INTEGER DEFAULT 0 CHECK(render_js IN (0, 1)),
  extraction_mode TEXT DEFAULT 'auto' CHECK(extraction_mode IN ('auto', 'manual', 'llm_semantic')),
  selector_config_json TEXT NOT NULL, -- JSON: { itemContainer, title, link, description, image, date, author, fallbacks: [] }
  confidence_json TEXT,              -- JSON: { title: 0.95, link: 1.0, date: 0.85, image: 0.9 }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_builder_source 
ON feed_builder_configs(source_id);


-- 2. FEED HEALTH SCORING & PREDICTIVE DRIFT METRICS
CREATE TABLE IF NOT EXISTS feed_health_metrics (
  source_id TEXT PRIMARY KEY,
  health_score INTEGER DEFAULT 100 CHECK(health_score BETWEEN 0 AND 100),
  field_health_json TEXT NOT NULL,   -- JSON: { title: 1.0, link: 1.0, date: 0.8, image: 0.95 }
  item_count_baseline REAL DEFAULT 15.0,
  last_item_count INTEGER DEFAULT 0,
  last_drift_detected_at INTEGER,
  last_healed_at INTEGER,
  recorded_at INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_health_score 
ON feed_health_metrics(health_score);


-- 3. DOMAIN LEARNING LAYER (Crowdsourced / Cached Domain Selector Recipes)
CREATE TABLE IF NOT EXISTS domain_patterns (
  domain TEXT PRIMARY KEY,           -- e.g. "artnews.com", "theverge.com"
  selector_config_json TEXT NOT NULL,
  confidence REAL DEFAULT 0.95,
  source TEXT DEFAULT 'auto' CHECK(source IN ('auto', 'user_correction', 'llm')),
  usage_count INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);


-- 4. FEED BUNDLES (Combine multiple feeds into one custom outbound RSS feed)
CREATE TABLE IF NOT EXISTS feed_bundles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  feed_ids_json TEXT NOT NULL,        -- JSON array of source_ids: ["src_1", "src_2"]
  is_public INTEGER DEFAULT 1 CHECK(is_public IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bundles_user 
ON feed_bundles(user_id);
