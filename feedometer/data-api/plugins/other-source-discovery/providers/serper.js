async function searchSerper(queryText, type, limit = 12) {
  const key = process.env.SERPER_API_KEY; if (!key) return [];
  const endpoint = type === 'news' ? 'news' : 'search';
  const suffix = { youtube: 'site:youtube.com', blogs: '-rss -feed blog', newsletters: '(site:substack.com OR newsletter)', news: '' }[type] || '';
  // Serper accepts at most ten results in a single request.  Page safely so
  // the UI can offer up to twenty real results without provoking a 400 error.
  const desired = Math.min(Math.max(Number(limit) || 12, 1), 20);
  const pages = Math.ceil(desired / 10);
  try {
    const responses = await Promise.all(Array.from({ length: pages }, async (_, index) => {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`https://google.serper.dev/${endpoint}`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ q: `${queryText} ${suffix}`.trim(), num: 10, page: index + 1 }) });
        if (!response.ok) throw new Error(`Serper request failed (HTTP ${response.status})`);
        return response.json();
      } finally { clearTimeout(timeout); }
    }));
    const rows = responses.flatMap((payload) => payload.organic || payload.news || []);
    return rows.map((item) => ({ type, title: item.title || 'Untitled source', description: item.snippet || item.description || '', url: item.link || item.url || '', publisher: item.source || item.domain || '', thumbnail_url: item.imageUrl || item.thumbnailUrl || '', published_at: item.date || null, provider: 'serper' })).filter((item) => /^https?:\/\//i.test(item.url));
  } catch (error) { throw error; }
}
module.exports = { searchSerper };
