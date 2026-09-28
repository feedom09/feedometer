/** Optional website-candidate provider. It is inert until SERPER_API_KEY is set. */
async function searchWebCandidates(query, limit = 10) {
  const key = process.env.SERPER_API_KEY;
  if (!key || !query) return [];
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ q: `${query} (RSS OR Atom OR feed)`, num: Math.min(Math.max(Number(limit) || 10, 1), 20) })
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.organic || []).map((item) => ({ website_url: item.link, feed_name: item.title || '', description: item.snippet || '', source_engine: 'serper-web' })).filter((item) => /^https?:\/\//i.test(item.website_url));
  } catch (_) { return []; } finally { clearTimeout(timeout); }
}
module.exports = { searchWebCandidates };
