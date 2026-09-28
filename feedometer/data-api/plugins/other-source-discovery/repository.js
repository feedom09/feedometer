const crypto = require('crypto');
const { query, sql } = require('../../config/db');

// Cache version separates results produced before a provider was configured
// from live-provider results.  This avoids showing a stale empty response
// after an administrator adds a search key.
const CACHE_VERSION = 'provider-v3';
function cacheKey(queryText, type) { return `${CACHE_VERSION}::${String(queryText).trim().toLowerCase()}::${type}`.slice(0, 255); }
async function read(queryText, type) {
  const result = await query('SELECT results_json FROM dbo.other_source_discovery_cache WHERE cache_key=@key AND expires_at>@now', { key: { type: sql.NVarChar(255), value: cacheKey(queryText, type) }, now: { type: sql.BigInt, value: Date.now() } });
  try { return result.recordset && result.recordset[0] ? JSON.parse(result.recordset[0].results_json) : null; } catch (_) { return null; }
}
async function write(queryText, type, results, ttlMs = 10 * 60 * 1000) {
  const now = Date.now(); const key = cacheKey(queryText, type); const json = JSON.stringify(results);
  await query(`IF EXISTS (SELECT 1 FROM dbo.other_source_discovery_cache WHERE cache_key=@key)
    UPDATE dbo.other_source_discovery_cache SET results_json=@json, result_count=@count, created_at=@now, expires_at=@expires WHERE cache_key=@key
    ELSE INSERT INTO dbo.other_source_discovery_cache (cache_key,source_type,results_json,result_count,created_at,expires_at) VALUES (@key,@type,@json,@count,@now,@expires)`, {
    key: { type: sql.NVarChar(255), value: key }, type: { type: sql.NVarChar(30), value: type }, json: { type: sql.NVarChar(sql.MAX), value: json }, count: { type: sql.Int, value: results.length }, now: { type: sql.BigInt, value: now }, expires: { type: sql.BigInt, value: now + ttlMs } });
}
async function saveResults(queryText, type, results) {
  const now = Date.now(); const key = cacheKey(queryText, type);
  for (const result of results) {
    const canonicalUrl = String(result.url || '').slice(0, 1000); if (!canonicalUrl) continue;
    const found = await query('SELECT id FROM dbo.other_source_discovery_results WHERE canonical_url=@url', { url: { type: sql.NVarChar(1000), value: canonicalUrl } });
    const id = found.recordset && found.recordset[0] ? found.recordset[0].id : `osd_${crypto.randomBytes(12).toString('hex')}`;
    await query(`IF EXISTS (SELECT 1 FROM dbo.other_source_discovery_results WHERE canonical_url=@url)
      UPDATE dbo.other_source_discovery_results SET query_key=@key,source_type=@type,title=@title,description=@description,publisher=@publisher,thumbnail_url=@thumbnail,provider=@provider,last_seen_at=@now WHERE canonical_url=@url
      ELSE INSERT INTO dbo.other_source_discovery_results (id,query_key,source_type,title,description,canonical_url,publisher,thumbnail_url,provider,created_at,last_seen_at) VALUES (@id,@key,@type,@title,@description,@url,@publisher,@thumbnail,@provider,@now,@now)`, {
      id: { type: sql.NVarChar(64), value: id }, key: { type: sql.NVarChar(255), value: key }, type: { type: sql.NVarChar(30), value: type }, title: { type: sql.NVarChar(500), value: String(result.title || 'Untitled').slice(0, 500) }, description: { type: sql.NVarChar(2000), value: String(result.description || '').slice(0, 2000) || null }, url: { type: sql.NVarChar(1000), value: canonicalUrl }, publisher: { type: sql.NVarChar(255), value: String(result.publisher || '').slice(0, 255) || null }, thumbnail: { type: sql.NVarChar(1000), value: String(result.thumbnail_url || '').slice(0, 1000) || null }, provider: { type: sql.NVarChar(50), value: result.provider || 'unknown' }, now: { type: sql.BigInt, value: now } });
  }
}
module.exports = { read, write, saveResults };
