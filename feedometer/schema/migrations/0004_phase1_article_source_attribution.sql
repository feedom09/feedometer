-- Phase 1: retain every source that delivered a canonically deduplicated article.
-- articles.source_id remains the original/primary source for existing reader queries.
CREATE TABLE IF NOT EXISTS article_source_attributions (
  article_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_item_guid TEXT,
  source_article_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (article_id, source_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_source_attributions_source_seen
ON article_source_attributions(source_id, last_seen_at DESC);

-- Preserve provenance for every article already in the catalog.
INSERT OR IGNORE INTO article_source_attributions (
  article_id, source_id, source_item_guid, source_article_url, first_seen_at, last_seen_at
)
SELECT id, source_id, NULL, url, ingested_at, ingested_at
FROM articles;
