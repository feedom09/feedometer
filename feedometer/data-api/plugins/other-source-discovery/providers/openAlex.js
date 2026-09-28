async function searchResearch(queryText, limit = 12) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(queryText)}&per-page=${Math.min(Math.max(Number(limit) || 12, 1), 25)}`, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'FeedOmeter Discovery/2.1 (research)' } });
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.results || []).map((item) => ({ type: 'research', title: item.title || 'Untitled research', description: item.abstract_inverted_index ? 'Research paper indexed by OpenAlex.' : '', url: item.doi ? `https://doi.org/${item.doi.replace(/^https?:\/\/doi.org\//, '')}` : item.id, publisher: item.primary_location && item.primary_location.source ? item.primary_location.source.display_name : '', published_at: item.publication_date || null, provider: 'openalex' })).filter((item) => /^https?:\/\//i.test(item.url));
  } catch (_) { return []; } finally { clearTimeout(timeout); }
}
module.exports = { searchResearch };
