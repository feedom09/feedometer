/**
 * Read-only live API smoke test. It never writes to D1, KV, or user data.
 * Override FEEDOMETER_API_BASE only when checking a deliberately chosen Worker.
 */
const apiBase = (process.env.FEEDOMETER_API_BASE || 'https://feedometer-api.feedometer.workers.dev').replace(/\/$/, '');
const response = await fetch(`${apiBase}/api/health`, { headers: { Accept: 'application/json' } });
if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}.`);
const body = await response.json();
if (body.status !== 'online' || body.dependencies?.database !== 'ok') {
  throw new Error(`API is not healthy: ${JSON.stringify(body)}`);
}
console.log(`PASS ${apiBase} is online with D1 reachable.`);
