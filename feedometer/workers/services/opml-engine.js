/**
 * workers/services/opml-engine.js — Edge OPML 2.0 Parser and Generator
 * Zero-dependency streaming XML parser & generator for Cloudflare Workers.
 */

/**
 * Decodes XML entities into raw strings.
 */
export function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&amp;/g, '&'); // Must be decoded last
}

/**
 * Escapes raw strings into safe XML attribute values.
 */
export function escapeXmlAttribute(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parses XML attributes from a single tag string.
 */
function parseAttributes(tagStr) {
  const attrs = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRegex.exec(tagStr)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] !== undefined ? match[2] : match[3];
    attrs[key] = decodeXmlEntities(val);
  }
  return attrs;
}

/**
 * Extracts domain/host from URL for fallback titles.
 */
function extractDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return 'RSS Feed';
  }
}

/**
 * Parses OPML 2.0 XML string into structured categories and feeds.
 * Supports Feedly, Inoreader, NewsBlur, NetNewsWire, Google Reader exports.
 *
 * @param {string} opmlText
 * @returns {{ title: string, folders: Array<{ name: string, feeds: Array<object> }>, rootFeeds: Array<object>, totalFeeds: number }}
 */
export function parseOpml(opmlText) {
  if (!opmlText || typeof opmlText !== 'string') {
    throw new Error('Invalid OPML text: payload is empty');
  }

  // Strip CDATA and comments
  let cleanText = opmlText
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, cdata) => escapeXmlAttribute(cdata));

  // Extract document title from <head><title>...</title></head>
  let docTitle = 'FeedOmeter Export';
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleanText);
  if (titleMatch && titleMatch[1]) {
    docTitle = decodeXmlEntities(titleMatch[1].trim());
  }

  // Match all <outline ...> or <outline ... /> or </outline> tokens
  const outlineTokenRegex = /<\/?outline(?:\s+[^>]*?)?\/?>/gi;
  let token;
  
  const folders = [];
  const rootFeeds = [];
  const folderMap = new Map(); // folderName -> Array of feeds

  let currentFolder = null;
  let totalFeeds = 0;

  while ((token = outlineTokenRegex.exec(cleanText)) !== null) {
    const tag = token[0];

    // Closing outline tag
    if (/^<\/outline/i.test(tag)) {
      currentFolder = null;
      continue;
    }

    const isSelfClosing = tag.endsWith('/>');
    const attrs = parseAttributes(tag);

    // Normalize attributes across various RSS reader exports
    const xmlUrl = attrs.xmlurl || attrs.xml_url || attrs.url || '';
    const htmlUrl = attrs.htmlurl || attrs.html_url || attrs.link || '';
    const title = attrs.title || attrs.text || attrs.description || (xmlUrl ? extractDomain(xmlUrl) : 'Untitled Feed');
    const type = (attrs.type || '').toLowerCase();
    const category = attrs.category || null;

    if (xmlUrl) {
      // Leaf node: It is an RSS/Atom/Podcast Feed
      const feedObj = {
        title: title.trim(),
        feedUrl: xmlUrl.trim(),
        websiteUrl: htmlUrl ? htmlUrl.trim() : '',
        sourceType: type || 'rss',
        category: category || (currentFolder ? currentFolder : 'General')
      };

      totalFeeds++;

      if (currentFolder) {
        if (!folderMap.has(currentFolder)) {
          folderMap.set(currentFolder, []);
        }
        folderMap.get(currentFolder).push(feedObj);
      } else {
        rootFeeds.push(feedObj);
      }
    } else {
      // Container node: It is a Category / Folder outline
      const folderName = (attrs.text || attrs.title || 'Uncategorized').trim();
      if (!isSelfClosing && folderName) {
        currentFolder = folderName;
        if (!folderMap.has(currentFolder)) {
          folderMap.set(currentFolder, []);
        }
      }
    }
  }

  // Convert folderMap to array
  for (const [name, feeds] of folderMap.entries()) {
    folders.push({ name, feeds });
  }

  return {
    title: docTitle,
    folders,
    rootFeeds,
    totalFeeds
  };
}

/**
 * Generates valid OPML 2.0 XML string from user folders, sources, and assignments.
 *
 * @param {object} params
 * @param {string} [params.title]
 * @param {string} [params.ownerName]
 * @param {Array<object>} params.folders - List of folder objects { id, name, icon }
 * @param {Array<object>} params.subscriptions - List of subscription objects { source_id, title, feed_url, website_url, category, source_type }
 * @param {Array<object>} [params.assignments] - List of assignments { folder_id, feed_id }
 * @returns {string} OPML 2.0 XML String
 */
export function generateOpml({
  title = 'FeedOmeter Subscriptions Export',
  ownerName = 'FeedOmeter User',
  folders = [],
  subscriptions = [],
  assignments = []
}) {
  const rfcDate = new Date().toUTCString();

  // Create folder lookups
  const folderIdToName = new Map();
  const folderFeedsMap = new Map();

  for (const f of folders) {
    folderIdToName.set(f.id, f.name);
    folderFeedsMap.set(f.name, []);
  }

  // Create feed assignment map (feed_id -> folder_name)
  const feedFolderMap = new Map();
  for (const a of assignments) {
    const fName = folderIdToName.get(a.folder_id);
    if (fName) {
      feedFolderMap.set(a.feed_id, fName);
    }
  }

  const rootFeeds = [];

  for (const sub of subscriptions) {
    const feedId = sub.source_id || sub.id;
    const folderName = feedFolderMap.get(feedId) || sub.folder_name;

    if (folderName && folderFeedsMap.has(folderName)) {
      folderFeedsMap.get(folderName).push(sub);
    } else {
      rootFeeds.push(sub);
    }
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<opml version="2.0">\n';
  xml += '  <head>\n';
  xml += '    <title>' + escapeXmlAttribute(title) + '</title>\n';
  xml += '    <dateCreated>' + rfcDate + '</dateCreated>\n';
  xml += '    <ownerName>' + escapeXmlAttribute(ownerName) + '</ownerName>\n';
  xml += '    <docs>http://opml.org/spec2.opml</docs>\n';
  xml += '  </head>\n';
  xml += '  <body>\n';

  // 1. Output Folders
  for (const [folderName, feeds] of folderFeedsMap.entries()) {
    if (feeds.length === 0) continue;
    xml += '    <outline text="' + escapeXmlAttribute(folderName) + '" title="' + escapeXmlAttribute(folderName) + '">\n';
    for (const feed of feeds) {
      const feedTitle = escapeXmlAttribute(feed.title || 'RSS Feed');
      const xmlUrl = escapeXmlAttribute(feed.feed_url || '');
      const htmlUrl = escapeXmlAttribute(feed.website_url || '');
      const type = escapeXmlAttribute(feed.source_type || 'rss');
      xml += '      <outline type="' + type + '" text="' + feedTitle + '" title="' + feedTitle + '" xmlUrl="' + xmlUrl + '" htmlUrl="' + htmlUrl + '" />\n';
    }
    xml += '    </outline>\n';
  }

  // 2. Output Root / Uncategorized Feeds
  for (const feed of rootFeeds) {
    const feedTitle = escapeXmlAttribute(feed.title || 'RSS Feed');
    const xmlUrl = escapeXmlAttribute(feed.feed_url || '');
    const htmlUrl = escapeXmlAttribute(feed.website_url || '');
    const type = escapeXmlAttribute(feed.source_type || 'rss');
    xml += '    <outline type="' + type + '" text="' + feedTitle + '" title="' + feedTitle + '" xmlUrl="' + xmlUrl + '" htmlUrl="' + htmlUrl + '" />\n';
  }

  xml += '  </body>\n';
  xml += '</opml>\n';

  return xml;
}
