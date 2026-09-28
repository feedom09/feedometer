/**
 * FeedOmeter 2.1 — Read-only Data API & SQL Server Smoke Test
 * Tests health, database connectivity, and catalog endpoints.
 */
const apiBase = (process.env.FEEDOMETER_API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');

console.log(`[Smoke Test] Checking Data API at ${apiBase}...`);

// 1. Health Check
const healthRes = await fetch(`${apiBase}/api/health`, { headers: { Accept: 'application/json' } });
if (!healthRes.ok) throw new Error(`Health check returned HTTP ${healthRes.status}.`);
const healthBody = await healthRes.json();
if (healthBody.status !== 'healthy' || !healthBody.database || healthBody.database.connected !== true) {
  throw new Error(`Data API is not healthy: ${JSON.stringify(healthBody)}`);
}
console.log(`✓ PASS: Data API is healthy. Connected to SQL Server DB: ${healthBody.database.name}`);

// 2. Catalog / Sources Check
const catalogRes = await fetch(`${apiBase}/api/catalog?limit=5`, { headers: { Accept: 'application/json' } });
if (!catalogRes.ok) throw new Error(`Catalog endpoint returned HTTP ${catalogRes.status}.`);
const catalogBody = await catalogRes.json();
if (catalogBody.status !== 'success' && !catalogBody.success) {
  throw new Error(`Catalog endpoint returned unexpected body: ${JSON.stringify(catalogBody)}`);
}
console.log(`✓ PASS: Catalog endpoint operational. Returned ${catalogBody.sources ? catalogBody.sources.length : 0} sources.`);

console.log(`\n🎉 ALL SMOKE TESTS PASSED for FeedOmeter 2.1 SQL Server Data API!`);

