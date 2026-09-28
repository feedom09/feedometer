const { canonicalFeedUrl } = require('../normalizer');

async function searchFeedlyDirectory(query, limit = 25, timeoutMs = 5000) {
  const value = String(query || '').trim();
  if (!value) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(value)}&n=${Math.min(Math.max(Number(limit) || 25, 1), 50)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'FeedOmeter RSS Discovery/2.1' }
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.results || []).map((item) => {
      const raw = String(item.feedId || item.id || '').replace(/^feed\//, '');
      const feedUrl = canonicalFeedUrl(raw);
      if (!/^https?:\/\//i.test(feedUrl)) return null;
      return {
        feed_name: item.title || new URL(feedUrl).hostname,
        feed_url: feedUrl,
        website_url: item.website || '',
        category: item.topics && item.topics[0] ? item.topics[0] : 'General',
        topics: item.topics || [], description: item.description || '',
        subscribers: Number(item.subscribers || item.subscribersCount || 0),
        velocity: Number(item.velocity || 0), article_count: Number(item.article_count || item.articlesCount || 0),
        last_updated: item.lastUpdated || item.updated || null, language: item.language || 'en',
        icon_url: item.iconUrl || item.visualUrl || '', source_engine: 'feedly-directory'
      };
    }).filter(Boolean);
  } catch (_) { return []; } finally { clearTimeout(timeout); }
}
module.exports = { searchFeedlyDirectory };
