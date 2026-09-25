/**
 * workers/services/rss-parser.js — Universal Namespace-Agnostic RSS 2.0 & Atom 1.0 XML Parser
 */

export function parseXmlFeed(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') {
    return { title: '', description: '', link: '', items: [] };
  }

  // Strip CDATA wrapper helper
  const cleanCdata = (str) => {
    if (!str) return '';
    return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
  };

  // Decode common XML/HTML entities
  const decodeEntities = (str) => {
    if (!str) return '';
    return str
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&#x2F;/gi, '/')
      .replace(/&#(\d+);/g, (_, num) => {
        try { return String.fromCharCode(parseInt(num, 10)); } catch (_) { return _; }
      });
  };

  // Helper to extract tag content (namespace agnostic)
  const extractTag = (block, tagName) => {
    const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tagName}>`, 'i');
    const match = block.match(regex);
    return match ? cleanCdata(match[1]) : '';
  };

  // Helper to extract attribute (namespace agnostic)
  const extractAttr = (block, tagName, attrName) => {
    const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tagName}[^>]*?\\s+${attrName}=["']([^"']+)["'][^>]*?\\/?>`, 'i');
    const match = block.match(regex);
    return match ? decodeEntities(match[1].trim()) : '';
  };

  const extractAtomLink = (block) => {
    const links = [...block.matchAll(/<(?:[a-zA-Z0-9_]+:)?link\b([^>]*)\/?>(?:<\/(?:[a-zA-Z0-9_]+:)?link>)?/gi)];
    for (const candidate of links) {
      const attrs = candidate[1] || '';
      const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
      const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase() || 'alternate';
      if (href && (rel === 'alternate' || !rel)) return decodeEntities(href.trim());
    }
    return extractAttr(block, 'link', 'href');
  };

  const resolveLink = (link, base) => {
    if (!link) return '';
    try { return new URL(link, base || undefined).toString(); } catch (_) { return link; }
  };

  // Pull a raw image URL out of the XML item (media:content, media:thumbnail, enclosure, itunes:image, <img>).
  // Junk filtering and upscaling happen in services/feed-imaging.js.
  const extractImage = (block) => {
    // 1. media:content (url, type=image or image ext or medium=image)
    const mediaContent = block.match(/<(?:[a-zA-Z0-9_]+:)?content\b[^>]*?\burl=["']([^"']+)["'][^>]*>/i);
    if (mediaContent && mediaContent[1]) {
      const u = decodeEntities(mediaContent[1].trim());
      const tagStr = mediaContent[0];
      if (/image/i.test(tagStr) || /\.(jpe?g|png|webp|avif|gif)(\?.*)?$/i.test(u) || (!/video|audio/i.test(tagStr) && !tagStr.includes('medium="audio"') && !tagStr.includes('medium="video"'))) {
        return u;
      }
    }

    // 2. media:thumbnail (url)
    const mediaThumb = block.match(/<(?:[a-zA-Z0-9_]+:)?thumbnail\b[^>]*?\burl=["']([^"']+)["'][^>]*>/i);
    if (mediaThumb && mediaThumb[1]) return decodeEntities(mediaThumb[1].trim());

    // 3. enclosure (url, type="image/*")
    const encMatch = block.match(/<enclosure\b[^>]*?\burl=["']([^"']+)["'][^>]*>/i);
    if (encMatch && encMatch[1]) {
      const tagStr = encMatch[0];
      if (/type=["']image\//i.test(tagStr) || /\.(jpe?g|png|webp|avif|gif)(\?.*)?$/i.test(encMatch[1])) {
        return decodeEntities(encMatch[1].trim());
      }
    }

    // 4. itunes:image (href)
    const itunesMatch = block.match(/<(?:[a-zA-Z0-9_]+:)?image\b[^>]*?\bhref=["']([^"']+)["'][^>]*>/i);
    if (itunesMatch && itunesMatch[1]) return decodeEntities(itunesMatch[1].trim());

    // 5. In-line images across ALL content bodies (content:encoded, content, description, summary)
    // Handles BOTH raw HTML (<img src="...">) and XML-entity escaped HTML (&lt;img src="..."&gt;)
    const rawBodies = [
      extractTag(block, 'encoded'),
      extractTag(block, 'content'),
      extractTag(block, 'description'),
      extractTag(block, 'summary')
    ].filter(Boolean).join(' ');

    if (rawBodies) {
      const decodedBodies = decodeEntities(rawBodies);
      const combinedHtml = rawBodies + ' ' + decodedBodies;

      const imgMatch = combinedHtml.match(/<img[^>]+(?:src|data-src|data-orig-file|data-lazy-src)=["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1]) {
        const candidate = decodeEntities(imgMatch[1].trim());
        if (!candidate.includes('feedburner.com') && !candidate.includes('1x1') && !/pixel|spacer|beacon|quantserve/i.test(candidate)) {
          return candidate;
        }
      }
    }

    return '';
  };

  // Helper to extract podcast audio enclosure
  const extractAudio = (block) => {
    const encUrl = extractAttr(block, 'enclosure', 'url');
    const encType = extractAttr(block, 'enclosure', 'type');
    if (encUrl && encType && encType.toLowerCase().startsWith('audio/')) {
      return { url: encUrl, type: encType };
    }
    return null;
  };

  // Extract Feed Header Metadata
  const feedTitle = extractTag(xmlText, 'title');
  const feedDesc = extractTag(xmlText, 'description') || extractTag(xmlText, 'subtitle');
  let feedLink = extractAtomLink(xmlText) || extractTag(xmlText, 'link');

  // Detect items: RSS <item> vs Atom <entry>
  const isAtom = /<(?:[a-zA-Z0-9_]+:)?entry\b/i.test(xmlText);
  const itemTag = isAtom ? 'entry' : 'item';
  const itemRegex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${itemTag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${itemTag}>`, 'gi');

  const items = [];
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemBlock = match[1];

    const title = extractTag(itemBlock, 'title');
    let link = isAtom ? extractAtomLink(itemBlock) : (extractAttr(itemBlock, 'link', 'href') || extractTag(itemBlock, 'link'));
    link = resolveLink(link, feedLink);
    const guid = extractTag(itemBlock, 'guid') || extractTag(itemBlock, 'id') || link;
    const content = extractTag(itemBlock, 'encoded') || extractTag(itemBlock, 'content') || '';
    const summary = extractTag(itemBlock, 'description') || extractTag(itemBlock, 'summary') || content;
    const published = extractTag(itemBlock, 'pubDate') || extractTag(itemBlock, 'published') || extractTag(itemBlock, 'updated') || extractTag(itemBlock, 'date');
    const authorBlock = extractTag(itemBlock, 'author');
    const author = extractTag(authorBlock, 'name') || authorBlock || extractTag(itemBlock, 'creator') || extractTag(itemBlock, 'publisher') || '';
    const image = extractImage(itemBlock);
    const audio = extractAudio(itemBlock);

    if (title || link) {
      items.push({
        title,
        link,
        guid,
        summary,
        content,
        published,
        author,
        image,
        audio
      });
    }
  }

  return {
    title: feedTitle,
    description: feedDesc,
    link: feedLink,
    items
  };
}
