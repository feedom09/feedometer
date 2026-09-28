/** SQL Server persistence boundary for discovery cache and candidates. */
const crypto = require('crypto'); const { query, sql } = require('../config/db');
// A query-result cache is an optimisation only.  Versioning prevents results
// produced before a relevance-rule change from being shown as fresh results.
const CACHE_VERSION = 'relevance-v2';
function cacheKey(normalizedQuery) { return `${CACHE_VERSION}:${normalizedQuery}`; }
async function readCache(normalizedQuery) {
  const result = await query('SELECT results_json FROM dbo.feed_discovery_cache WHERE normalized_query = @key AND expires_at > @now', { key: { type: sql.NVarChar(255), value: cacheKey(normalizedQuery) }, now: { type: sql.BigInt, value: Date.now() } });
  try { return result.recordset && result.recordset[0] ? JSON.parse(result.recordset[0].results_json) : null; } catch (_) { return null; }
}
async function writeCache(normalizedQuery, data, ttlMs = 10 * 60 * 1000) {
  const now = Date.now(); await query(`IF EXISTS (SELECT 1 FROM dbo.feed_discovery_cache WHERE normalized_query=@key)
    UPDATE dbo.feed_discovery_cache SET results_json=@results,total_sources_found=@sources,total_articles_found=@articles,created_at=@now,expires_at=@expires WHERE normalized_query=@key
    ELSE INSERT INTO dbo.feed_discovery_cache (normalized_query,results_json,total_sources_found,total_articles_found,created_at,expires_at) VALUES (@key,@results,@sources,@articles,@now,@expires)`, {
    key: { type: sql.NVarChar(255), value: cacheKey(normalizedQuery) }, results: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(data) }, sources: { type: sql.Int, value: Number(data.total || 0) }, articles: { type: sql.Int, value: Number(data.total_articles_found || 0) }, now: { type: sql.BigInt, value: now }, expires: { type: sql.BigInt, value: now + ttlMs } });
}
async function saveCandidate(queryKey, candidate) {
  const found = await query('SELECT id FROM dbo.discovered_sources WHERE feed_url=@feedUrl', { feedUrl: { type: sql.NVarChar(1000), value: candidate.feed_url } });
  const id = found.recordset && found.recordset[0] ? found.recordset[0].id : `disc_${crypto.randomBytes(12).toString('hex')}`; const now = Date.now();
  await query(`IF EXISTS (SELECT 1 FROM dbo.discovered_sources WHERE feed_url=@feedUrl)
    UPDATE dbo.discovered_sources SET query_key=@queryKey,title=@title,description=@description,site_url=@siteUrl,category=@category,discovery_score=@score,created_at=@now WHERE feed_url=@feedUrl
    ELSE INSERT INTO dbo.discovered_sources (id,query_key,title,description,site_url,feed_url,feed_type,category,discovery_score,created_at) VALUES (@id,@queryKey,@title,@description,@siteUrl,@feedUrl,'rss',@category,@score,@now)`, {
    id: { type: sql.NVarChar(64), value: id }, queryKey: { type: sql.NVarChar(255), value: queryKey }, title: { type: sql.NVarChar(255), value: candidate.feed_name || candidate.title || 'Discovered Feed' }, description: { type: sql.NVarChar(1000), value: candidate.description || null }, siteUrl: { type: sql.NVarChar(1000), value: candidate.website_url || candidate.feed_url }, feedUrl: { type: sql.NVarChar(1000), value: candidate.feed_url }, category: { type: sql.NVarChar(100), value: candidate.category || null }, score: { type: sql.Float, value: Number(candidate.discovery_score || 0) }, now: { type: sql.BigInt, value: now } });
}
async function searchCatalog(variants, limit = 30) {
  const terms = (variants || []).filter(Boolean).slice(0, 5).map((value) => `%${value}%`);
  if (!terms.length) return [];
  const where = terms.map((_, index) => `(LOWER(title) LIKE @term${index} OR LOWER(category) LIKE @term${index} OR LOWER(feed_url) LIKE @term${index})`).join(' OR ');
  const params = { limit: { type: sql.Int, value: Math.min(Math.max(Number(limit) || 30, 1), 100) } };
  terms.forEach((term, index) => { params[`term${index}`] = { type: sql.NVarChar(255), value: term }; });
  const sourceRows = await query(`SELECT TOP (@limit) title AS feed_name, feed_url, website_url, category, language, logo_url AS icon_url, article_count, last_article_at AS last_updated, 'sql-sources' AS source_engine FROM dbo.sources WHERE status='active' AND (${where})`, params);
  const discoveredRows = await query(`SELECT TOP (@limit) title AS feed_name, feed_url, site_url AS website_url, category, 'en' AS language, discovery_score, subscriber_count AS subscribers, publishing_frequency AS velocity, 'sql-discovered' AS source_engine FROM dbo.discovered_sources WHERE (${where}) ORDER BY discovery_score DESC`, params);
  return [...(sourceRows.recordset || []), ...(discoveredRows.recordset || [])];
}
module.exports = { readCache, writeCache, saveCandidate, searchCatalog };
