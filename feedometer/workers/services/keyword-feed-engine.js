/**
 * workers/services/keyword-feed-engine.js — Virtual Keyword & Topic RSS Engine
 * Generates Google-News-style dynamic virtual RSS feeds for topics and keywords.
 * Synthesizes articles from Cloudflare D1 and global catalog with deduplication.
 */

import { discoverFeedsAndArticles, findFeedsUnified } from './feed-discovery-engine.js';

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates a virtual topic feed for a given keyword query.
 * @param {string} rawQuery 
 * @param {Object} env 
 * @returns {Promise<Object>} Dynamic topic feed with items and RSS 2.0 XML
 */
export async function generateKeywordFeed(rawQuery, env = null) {
  const query = String(rawQuery || '').trim();
  if (!query) {
    throw new Error('Search query or topic keyword is required.');
  }

  const items = [];
  const seenUrls = new Set();

  // 1. Search D1 database articles matching keyword
  if (env && env.DB) {
    try {
      const kwParam = `%${query.toLowerCase()}%`;
      const rows = await env.DB.prepare(`
        SELECT a.id, a.title, a.url, a.snippet, a.author, a.image_url, a.published_at,
               s.title AS source_title, s.feed_url
        FROM articles a
        LEFT JOIN sources s ON a.source_id = s.id
        WHERE LOWER(a.title) LIKE ? OR LOWER(a.snippet) LIKE ?
        ORDER BY a.published_at DESC
        LIMIT 35
      `).bind(kwParam, kwParam).all();

      for (const row of (rows.results || [])) {
        if (!row.url || seenUrls.has(row.url)) continue;
        seenUrls.add(row.url);

        const pubDate = row.published_at
          ? new Date(typeof row.published_at === 'number' && row.published_at < 1e11 ? row.published_at * 1000 : row.published_at).toUTCString()
          : new Date().toUTCString();

        items.push({
          id: row.id,
          source_post_id: row.id,
          platform: 'keyword',
          title: row.title || 'Untitled Article',
          link: row.url,
          description: (row.snippet || '').slice(0, 300),
          pubDate: pubDate,
          published_at: row.published_at || Math.floor(Date.now() / 1000),
          image: row.image_url || '',
          author: row.author || row.source_title || 'Topic Stream'
        });
      }
    } catch (e) {
      console.warn('D1 keyword search fallback:', e.message);
    }
  }

  // 2. If D1 has few results, enrich with discovery engine
  if (items.length < 15) {
    try {
      const disc = await discoverFeedsAndArticles(query);
      if (disc && Array.isArray(disc.articles)) {
        for (const art of disc.articles) {
          if (!art.link || seenUrls.has(art.link)) continue;
          seenUrls.add(art.link);

          const pubDate = art.pubDate ? new Date(art.pubDate).toUTCString() : new Date().toUTCString();
          items.push({
            id: art.link,
            source_post_id: art.link,
            platform: 'keyword',
            title: art.title || 'Untitled',
            link: art.link,
            description: (art.description || art.snippet || '').slice(0, 300),
            pubDate: pubDate,
            published_at: Math.floor(new Date(pubDate).getTime() / 1000),
            image: art.image || art.ogImage || '',
            author: art.source || 'Topic Stream'
          });
          if (items.length >= 35) break;
        }
      }
    } catch (_) {}
  }

  if (items.length === 0) {
    // If still empty, synthesize a placeholder notice
    items.push({
      id: `topic_${Date.now()}`,
      source_post_id: `topic_${Date.now()}`,
      platform: 'keyword',
      title: `Topic Stream created for "${query}"`,
      link: `https://feedometer.com/search?q=${encodeURIComponent(query)}`,
      description: `New articles and posts matching "${query}" will populate automatically as feeds refresh.`,
      pubDate: new Date().toUTCString(),
      published_at: Math.floor(Date.now() / 1000),
      image: '',
      author: 'FeedOmeter Intelligence'
    });
  }

  // Sort latest first
  items.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  // Generate clean standard RSS 2.0 XML
  const nowUtc = new Date().toUTCString();
  const formattedTitle = query.charAt(0).toUpperCase() + query.slice(1);
  const virtualFeedUrl = `/api/view?q=${encodeURIComponent(query)}`;

  const xmlItems = items.map(item => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.link)}</guid>
      <pubDate>${item.pubDate}</pubDate>
      <author>${escapeXml(item.author)}</author>
      <description>${escapeXml(item.description)}</description>
      ${item.image ? `<media:content url="${escapeXml(item.image)}" medium="image" />` : ''}
    </item>`).join('\n');

  const generatedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Topic: ${escapeXml(formattedTitle)}</title>
    <link>https://feedometer.com</link>
    <description>Virtual RSS stream for keyword topic: ${escapeXml(query)}</description>
    <language>en</language>
    <lastBuildDate>${nowUtc}</lastBuildDate>
    <generator>FeedOmeter Keyword Feed Engine 2.1</generator>
    <atom:link href="${escapeXml(virtualFeedUrl)}" rel="self" type="application/rss+xml" />
${xmlItems}
  </channel>
</rss>`;

  return {
    ok: true,
    sourceType: 'keyword',
    query: query,
    feedUrl: virtualFeedUrl,
    siteUrl: `https://feedometer.com/search?q=${encodeURIComponent(query)}`,
    meta: {
      title: `Topic: ${formattedTitle}`,
      description: `Virtual RSS stream for "${query}"`,
      image: items[0]?.image || '',
      source_type: 'keyword'
    },
    items: items,
    xml: generatedXml
  };
}
