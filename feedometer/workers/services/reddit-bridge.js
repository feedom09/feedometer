/**
 * workers/services/reddit-bridge.js — Native Reddit RSS Bridge
 * Resolves subreddits, multireddits, and users into native Reddit Atom/RSS feeds.
 * High-performance, zero API keys, ToS-compliant.
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
 * Resolves any Reddit input into a canonical Reddit .rss feed URL.
 * @param {string} input 
 * @returns {string} Canonical Reddit RSS feed URL
 */
export function resolveRedditFeedUrl(input) {
  const clean = String(input || '').trim();

  // 1. Shorthand r/subreddit
  const subShort = clean.match(/^r\/([a-zA-Z0-9_]+)$/i);
  if (subShort) {
    return `https://www.reddit.com/r/${subShort[1]}/.rss`;
  }

  // 2. Shorthand u/username
  const userShort = clean.match(/^u\/([a-zA-Z0-9_-]+)$/i);
  if (userShort) {
    return `https://www.reddit.com/user/${userShort[1]}/.rss`;
  }

  // 3. Full Reddit URLs
  let urlObj;
  try {
    const prefixed = clean.startsWith('http') ? clean : `https://${clean}`;
    urlObj = new URL(prefixed);
  } catch (_) {
    urlObj = null;
  }

  if (urlObj && urlObj.hostname.includes('reddit.com')) {
    let pathname = urlObj.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('.rss')) {
      pathname = `${pathname}/.rss`;
    }
    return `https://www.reddit.com${pathname}${urlObj.search}`;
  }

  // Fallback
  return `https://www.reddit.com/r/${clean.replace(/[^a-zA-Z0-9_]/g, '')}/.rss`;
}

/**
 * Fetches and normalizes a Reddit native RSS feed.
 * @param {string} input 
 * @param {Object} env 
 * @returns {Promise<Object>} Normalized feed object with items and RSS XML
 */
export async function fetchRedditFeed(input, env = null) {
  const feedUrl = resolveRedditFeedUrl(input);

  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 FeedOmeter/2.1',
      'Accept': 'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Subreddit or Reddit user does not exist.`);
    }
    if (res.status === 403) {
      throw new Error(`Subreddit is private or restricted.`);
    }
    throw new Error(`Reddit returned HTTP status ${res.status}`);
  }

  const rawXml = await res.text();
  const parsed = parseXmlFeed(rawXml);

  // Determine community / title
  const titleMatch = rawXml.match(/<title>([^<]+)<\/title>/i);
  const communityTitle = (titleMatch && decodeEntities(titleMatch[1])) || parsed.title || 'Reddit Community';

  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let entryMatch;

  while ((entryMatch = entryRegex.exec(rawXml)) !== null) {
    const chunk = entryMatch[1];

    const idMatch = chunk.match(/<id>([^<]+)<\/id>/i);
    const rawId = idMatch ? idMatch[1].trim() : '';
    const postIdMatch = rawId.match(/t3_([a-zA-Z0-9]+)/i);
    const sourcePostId = postIdMatch ? `t3_${postIdMatch[1]}` : rawId;

    const titleMatch = chunk.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/<[^>]+>/g, '').trim() : 'Untitled Post';

    const linkMatch = chunk.match(/<link\s+[^>]*href=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1].trim() : '';

    const authorMatch = chunk.match(/<author>\s*<name>([^<]+)<\/name>/i);
    const author = authorMatch ? decodeEntities(authorMatch[1]).trim() : '';

    const updatedMatch = chunk.match(/<updated>([^<]+)<\/updated>/i) || chunk.match(/<published>([^<]+)<\/published>/i);
    const pubDate = updatedMatch ? new Date(updatedMatch[1]).toUTCString() : new Date().toUTCString();

    const contentMatch = chunk.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    let rawContent = contentMatch ? decodeEntities(contentMatch[1]) : '';

    // Extract image preview if embedded in Reddit HTML content
    let image = '';
    const imgMatch = rawContent.match(/<img\s+[^>]*src=["']([^"']+)["']/i);
    if (imgMatch && /^https?:\/\//i.test(imgMatch[1])) {
      image = imgMatch[1];
    } else {
      const previewMatch = rawContent.match(/https:\/\/(?:preview|external-preview|i)\.redd\.it\/[^\s"']+/i);
      if (previewMatch) image = previewMatch[0];
    }

    // Clean snippet text
    const cleanSnippet = rawContent
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/submitted by\s+\/u\/[^\s]+/gi, '')
      .replace(/\[link\]\s+\[comments\]/gi, '')
      .trim();

    if (title && link) {
      items.push({
        id: sourcePostId ? `reddit:${sourcePostId}` : link,
        source_post_id: sourcePostId,
        platform: 'reddit',
        title: title,
        link: link,
        description: cleanSnippet.slice(0, 300),
        pubDate: pubDate,
        published_at: Math.floor(new Date(pubDate).getTime() / 1000),
        image: image,
        author: author
      });
    }
  }

  // Generate clean standard RSS 2.0 XML
  const nowUtc = new Date().toUTCString();
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
    <title>${escapeXml(communityTitle)}</title>
    <link>https://www.reddit.com</link>
    <description>Reddit community feed for ${escapeXml(communityTitle)}</description>
    <language>en</language>
    <lastBuildDate>${nowUtc}</lastBuildDate>
    <generator>FeedOmeter Reddit RSS Bridge 2.1</generator>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${xmlItems}
  </channel>
</rss>`;

  return {
    ok: true,
    sourceType: 'reddit',
    feedUrl: feedUrl,
    siteUrl: items[0]?.link || `https://www.reddit.com`,
    meta: {
      title: communityTitle,
      description: `Reddit community feed for ${communityTitle}`,
      image: items[0]?.image || '',
      source_type: 'reddit'
    },
    items: items,
    xml: generatedXml
  };
}
