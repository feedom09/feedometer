-- Optional Other-than-RSS Discovery plug-in. These tables are intentionally
-- separate from dbo.sources, RSS discovery cache, and user subscriptions.
IF OBJECT_ID('dbo.other_source_discovery_cache', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.other_source_discovery_cache (
    cache_key NVARCHAR(255) NOT NULL CONSTRAINT PK_other_source_discovery_cache PRIMARY KEY,
    source_type NVARCHAR(30) NOT NULL,
    results_json NVARCHAR(MAX) NOT NULL,
    result_count INT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX idx_other_source_discovery_cache_expires ON dbo.other_source_discovery_cache(expires_at);
END
GO
IF OBJECT_ID('dbo.other_source_discovery_results', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.other_source_discovery_results (
    id NVARCHAR(64) NOT NULL CONSTRAINT PK_other_source_discovery_results PRIMARY KEY,
    query_key NVARCHAR(255) NOT NULL,
    source_type NVARCHAR(30) NOT NULL,
    title NVARCHAR(500) NOT NULL,
    description NVARCHAR(2000) NULL,
    canonical_url NVARCHAR(1000) NOT NULL CONSTRAINT UQ_other_source_discovery_results_url UNIQUE,
    publisher NVARCHAR(255) NULL,
    thumbnail_url NVARCHAR(1000) NULL,
    provider NVARCHAR(50) NOT NULL,
    created_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL
  );
  CREATE INDEX idx_other_source_discovery_results_query ON dbo.other_source_discovery_results(query_key, source_type, last_seen_at DESC);
END
GO
