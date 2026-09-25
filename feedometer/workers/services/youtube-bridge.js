/**
 * workers/services/youtube-bridge.js — Native YouTube RSS Bridge
 * Resolves YouTube handles, channels, and playlists into official YouTube Atom/RSS feeds.
 * High-performance, zero API keys required, ToS-compliant.
 */

import { parseXmlFeed } from './rss-parser.js';
import { decodeEntities } from './metadata-scraper.js';

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
 * Resolves any YouTube URL, @handle, or channel ID to the official videos.xml feed URL.
 * @param {string} input 
 * @param {Object} env Cloudflare Worker env (for KV caching)
 * @returns {Promise<string>} Official YouTube RSS feed URL
 */
export async function resolveYouTubeFeedUrl(input, env = null) {
  const clean = String(input || '').trim();

  // 1. Direct channel ID pattern
  const directChannel = clean.match(/(?:channel\/|^)(UC[a-zA-Z0-9_-]{18,32})/i);
  if (directChannel) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${directChannel[1]}`;
  }

  // 2. Playlist pattern
  const playlistMatch = clean.match(/list=([a-zA-Z0-9_-]+)/i);
  if (playlistMatch) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistMatch[1]}`;
  }

  // 3. User pattern
  const userMatch = clean.match(/youtube\.com\/user\/([a-zA-Z0-9_-]+)/i);
  if (userMatch) {
    return `https://www.youtube.com/feeds/videos.xml?user=${userMatch[1]}`;
  }

  // 4. Handle or custom URL pattern (e.g. @NBA or youtube.com/@NBA)
  let handle = '';
  const handleMatch = clean.match(/(?:youtube\.com\/)?@([a-zA-Z0-9_.-]+)/i);
  if (handleMatch) {
    handle = handleMatch[1];
  } else if (/^@?[a-zA-Z0-9_.-]+$/i.test(clean) && !clean.includes('.')) {
    handle = clean.replace(/^@/, '');
  }

  if (handle) {
    // Check KV Cache for resolved channel_id
    const cacheKey = `yt_handle:${handle.toLowerCase()}`;
    if (env && env.FEEDS_KV) {
      try {
        const cached = await env.FEEDS_KV.get(cacheKey);
        if (cached) {
          return `https://www.youtube.com/feeds/videos.xml?channel_id=${cached}`;
        }
      } catch (_) {}
    }

    // Fetch channel landing page to extract channel ID
    const targetUrl = `https://www.youtube.com/@${handle}`;
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (res.ok) {
        const html = await res.text();
        
        // Match channel_id in RSS link or meta tag
        const rssMatch = html.match(/channel_id=([a-zA-Z0-9_-]{24})/i)
          || html.match(/<meta\s+itemprop=["']identifier["']\s+content=["'](UC[a-zA-Z0-9_-]{22})["']/i)
          || html.match(/<meta\s+itemprop=["']channelId["']\s+content=["'](UC[a-zA-Z0-9_-]{22})["']/i)
          || html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/i);

        if (rssMatch && rssMatch[1]) {
          const channelId = rssMatch[1];
          if (env && env.FEEDS_KV) {
            try {
              await env.FEEDS_KV.put(cacheKey, channelId, { expirationTtl: 86400 * 30 }); // 30 days
            } catch (_) {}
          }
          return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        }
      }
    } catch (_) {}
  }

  // Fallback: if already a valid YouTube feed url
  if (clean.includes('youtube.com/feeds/videos.xml')) {
    return clean.startsWith('http') ? clean : `https://${clean}`;
  }

  throw new Error(`Unable to resolve YouTube feed for "${clean}". Channel may not exist or is private.`);
}

/**
 * Fetches and normalizes a YouTube native XML feed.
 * @param {string} input 
 * @param {Object} env 
 * @returns {Promise<Object>} Normalized feed object with items and RSS XML
 */
export async function fetchYouTubeFeed(input, env = null) {
  const feedUrl = await resolveYouTubeFeedUrl(input, env);

  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FeedOmeter/2.1; +https://feedometer.com)',
      'Accept': 'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!res.ok) {
    throw new Error(`YouTube returned HTTP status ${res.status}`);
  }

  const rawXml = await res.text();
  const parsed = parseXmlFeed(rawXml);

  // Extract author name / channel title
  const authorMatch = rawXml.match(/<author>\s*<name>([^<]+)<\/name>/i);
  const authorName = (authorMatch && decodeEntities(authorMatch[1])) || parsed.title || 'YouTube Channel';

  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let entryMatch;

  while ((entryMatch = entryRegex.exec(rawXml)) !== null) {
    const chunk = entryMatch[1];
    
    const idMatch = chunk.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) || chunk.match(/<id>.*?([a-zA-Z0-9_-]{11})<\/id>/i);
    const videoId = idMatch ? idMatch[1].trim() : '';
    
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/<[^>]+>/g, '').trim() : 'Untitled Video';
    
    const linkMatch = chunk.match(/<link\s+[^>]*href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1].trim() : (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

    const pubMatch = chunk.match(/<published>([^<]+)<\/published>/i) || chunk.match(/<updated>([^<]+)<\/updated>/i);
    const pubDate = pubMatch ? new Date(pubMatch[1]).toUTCString() : new Date().toUTCString();

    const descMatch = chunk.match(/<media:description>([\s\S]*?)<\/media:description>/i);
    const description = descMatch ? decodeEntities(descMatch[1]).trim() : '';

    const thumbMatch = chunk.match(/<media:thumbnail\s+[^>]*url=["']([^"']+)["']/i);
    let image = thumbMatch ? thumbMatch[1].trim() : '';
    if (!image && videoId) {
      image = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }

    if (title && (link || videoId)) {
      items.push({
        id: videoId ? `yt:${videoId}` : link,
        source_post_id: videoId ? `yt:video:${videoId}` : '',
        platform: 'youtube',
        title: title,
        link: link,
        description: description.slice(0, 300),
        pubDate: pubDate,
        published_at: Math.floor(new Date(pubDate).getTime() / 1000),
        image: image,
        author: authorName
      });
    }
  }

  // Generate clean RSS 2.0 XML
  const nowUtc = new Date().toUTCString();
  const xmlItems = items.map(item => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.link)}</guid>
      <pubDate>${item.pubDate}</pubDate>
      <author>${escapeXml(item.author || authorName)}</author>
      <description>${escapeXml(item.description)}</description>
      ${item.image ? `<media:content url="${escapeXml(item.image)}" medium="image" />` : ''}
    </item>`).join('\n');

  const generatedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(authorName)} (YouTube)</title>
    <link>https://www.youtube.com</link>
    <description>Latest video uploads from ${escapeXml(authorName)}</description>
    <language>en</language>
    <lastBuildDate>${nowUtc}</lastBuildDate>
    <generator>FeedOmeter YouTube RSS Bridge 2.1</generator>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${xmlItems}
  </channel>
</rss>`;

  return {
    ok: true,
    sourceType: 'youtube',
    feedUrl: feedUrl,
    siteUrl: items[0]?.link || `https://www.youtube.com`,
    meta: {
      title: `${authorName} (YouTube)`,
      description: `Latest videos from ${authorName}`,
      image: items[0]?.image || '',
      source_type: 'youtube'
    },
    items: items,
    xml: generatedXml
  };
}
