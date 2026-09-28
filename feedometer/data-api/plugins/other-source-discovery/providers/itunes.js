async function searchPodcasts(queryText, limit = 12) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=${Math.min(Math.max(Number(limit) || 12, 1), 25)}&term=${encodeURIComponent(queryText)}`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.results || []).map((item) => ({ type: 'podcasts', title: item.collectionName || item.trackName || 'Untitled podcast', description: item.primaryGenreName || '', url: item.collectionViewUrl || item.trackViewUrl || '', publisher: item.artistName || '', thumbnail_url: item.artworkUrl600 || item.artworkUrl100 || '', published_at: item.releaseDate || null, provider: 'itunes' })).filter((item) => /^https?:\/\//i.test(item.url));
  } catch (_) { return []; } finally { clearTimeout(timeout); }
}
module.exports = { searchPodcasts };
