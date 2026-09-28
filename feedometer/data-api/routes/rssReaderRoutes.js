const express = require('express');

const router = express.Router();

function decodeXml(value = '') {
  return String(value)
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml, name) {
  const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function attribute(xml, elementName, attributeName) {
  const element = elementName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const attributeNameEscaped = attributeName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${element}\\b[^>]*\\b${attributeNameEscaped}=["']([^"']+)["'][^>]*\\/?`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function imageFrom(item) {
  return attribute(item, 'media:content', 'url')
    || attribute(item, 'media:thumbnail', 'url')
    || attribute(item, 'enclosure', 'url')
    || ((String(item).match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i) || [])[1] || '');
}

function parseRss(xml, feedUrl) {
  const channelMatch = String(xml).match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i);
  if (channelMatch) {
    const channel = channelMatch[1];
    const items = [...channel.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => {
      const item = match[1];
      const description = tag(item, 'description') || tag(item, 'content:encoded');
      return {
        title: tag(item, 'title') || 'Untitled',
        link: tag(item, 'link') || tag(item, 'guid'),
        description,
        pubDate: tag(item, 'pubDate') || tag(item, 'dc:date'),
        publishedAt: tag(item, 'pubDate') || tag(item, 'dc:date'),
        author: tag(item, 'dc:creator') || tag(item, 'author'),
        image: imageFrom(item)
      };
    }).filter((item) => item.link || item.title !== 'Untitled');
    return {
      title: tag(channel, 'title') || 'RSS Feed',
      link: tag(channel, 'link') || feedUrl,
      description: tag(channel, 'description'),
      items
    };
  }

  const feedMatch = String(xml).match(/<feed\b[^>]*>([\s\S]*?)<\/feed>/i);
  if (feedMatch) {
    const feed = feedMatch[1];
    const items = [...feed.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => {
      const entry = match[1];
      return {
        title: tag(entry, 'title') || 'Untitled',
        link: attribute(entry, 'link', 'href'),
        description: tag(entry, 'summary') || tag(entry, 'content'),
        pubDate: tag(entry, 'published') || tag(entry, 'updated'),
        publishedAt: tag(entry, 'published') || tag(entry, 'updated'),
        author: tag(entry, 'name'),
        image: imageFrom(entry)
      };
    }).filter((item) => item.link || item.title !== 'Untitled');
    return {
      title: tag(feed, 'title') || 'RSS Feed',
      link: attribute(feed, 'link', 'href') || feedUrl,
      description: tag(feed, 'subtitle'),
      items
    };
  }

  return null;
}

router.get('/view', async (req, res) => {
  const feedUrl = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(feedUrl)) {
    return res.status(400).json({ ok: false, success: false, error: 'A valid HTTP(S) feed URL is required.' });
  }

  const edgeOrigin = String(process.env.EDGE_WORKER_ORIGIN || '').replace(/\/$/, '');
  let xml = null;

  if (edgeOrigin) {
    try {
      const endpoint = `${edgeOrigin}/api/edge/feed?url=${encodeURIComponent(feedUrl)}`;
      const response = await fetch(endpoint, {
        headers: { accept: 'application/xml, text/xml, application/rss+xml, application/atom+xml' },
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) {
        xml = await response.text();
      }
    } catch (e) {
      console.warn('[RSS Reader] Edge feed service attempt failed, falling back to direct fetch:', e.message);
    }
  }

  if (!xml) {
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'user-agent': 'FeedOmeter/2.1 (+https://feedometer.com)',
          'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5'
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        return res.status(502).json({ ok: false, success: false, error: `Upstream feed returned status ${response.status}.` });
      }
      xml = await response.text();
    } catch (directErr) {
      console.error('[RSS Reader] Direct feed fetch failed:', directErr.message);
      return res.status(502).json({ ok: false, success: false, error: `Failed to fetch feed: ${directErr.message}` });
    }
  }

  try {
    const parsed = parseRss(xml, feedUrl);
    if (!parsed || !parsed.items.length) {
      return res.status(422).json({ ok: false, success: false, error: 'The feed could not be parsed or contains no entries.' });
    }

    return res.json({
      ok: true,
      success: true,
      feedUrl,
      meta: {
        title: parsed.title,
        link: parsed.link,
        description: parsed.description,
        url: feedUrl
      },
      items: parsed.items
    });
  } catch (error) {
    console.error('[RSS Reader] Feed parse error:', error.message);
    return res.status(422).json({ ok: false, success: false, error: 'Feed parsing failed.' });
  }
});

module.exports = router;
