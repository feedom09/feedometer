/**
 * workers/services/source-detector.js — FeedOmeter Smart Source Classifier
 * Detects whether user input is a YouTube channel/handle, Reddit subreddit, direct RSS/Atom, standard website, or a topic keyword.
 * ES6 module designed for Cloudflare Worker & browser environments.
 */

// Common top-level domains for website identification
const TLD_REGEX = /\.(com|org|net|io|ai|co|app|dev|news|info|biz|me|tech|blog|tv|online|site|space|xyz|gov|edu|uk|us|in|eu|de|fr|jp|ca|au|br|ru|ch|nl|se|no|es|it|nz|asia|media|world|global|live|club|agency|today|top|vip|digital|cloud|studio|design|store|shop|link|click|stream)([\/:?#]|$)/i;

/**
 * Classifies an arbitrary user input string.
 * @param {string} rawInput 
 * @returns {Object} classification result
 */
export function detectSourceType(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) {
    return {
      type: 'unknown',
      raw: '',
      normalized: '',
      badge: { label: 'Unknown', icon: '❓', color: '#64748b' }
    };
  }

  // 1. YouTube Detection
  const ytResult = checkYouTube(input);
  if (ytResult) return ytResult;

  // 2. Reddit Detection
  const redditResult = checkReddit(input);
  if (redditResult) return redditResult;

  // 3. Direct RSS / Atom / XML Feed Detection
  const rssResult = checkDirectRss(input);
  if (rssResult) return rssResult;

  // 4. Standard Website Detection
  const webResult = checkWebsite(input);
  if (webResult) return webResult;

  // 5. Keyword / Topic Query Fallback
  return {
    type: 'keyword',
    raw: input,
    query: input,
    normalized: input,
    badge: { label: 'Topic Feed', icon: '🔍', color: '#8b5cf6' },
    description: `Virtual topic stream for "${input}"`
  };
}

/**
 * Checks if input matches YouTube handle, channel, playlist, or video.
 */
function checkYouTube(input) {
  // @handle format (e.g. @NBA or @veritasium)
  if (/^@([a-zA-Z0-9_.-]+)$/i.test(input)) {
    const handle = input.replace(/^@/, '');
    return {
      type: 'youtube',
      subtype: 'handle',
      handle: handle,
      raw: input,
      normalized: `https://www.youtube.com/@${handle}`,
      badge: { label: 'YouTube Channel', icon: '📺', color: '#ef4444' },
      target: `@${handle}`
    };
  }

  // YouTube URLs
  const ytUrlPattern = /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]+|c\/[\w.-]+|user\/[\w.-]+|playlist\?list=[\w-]+|watch\?v=[\w-]+)/i;
  const youtuBePattern = /^(https?:\/\/)?youtu\.be\/([\w-]+)/i;

  if (ytUrlPattern.test(input) || youtuBePattern.test(input)) {
    let normalized = input.startsWith('http') ? input : `https://${input}`;
    let subtype = 'channel';
    let handle = '';
    let channelId = '';

    const handleMatch = normalized.match(/youtube\.com\/@([\w.-]+)/i);
    const channelMatch = normalized.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
    const playlistMatch = normalized.match(/list=([\w-]+)/i);
    const userMatch = normalized.match(/youtube\.com\/user\/([\w.-]+)/i);

    if (handleMatch) {
      subtype = 'handle';
      handle = handleMatch[1];
    } else if (channelMatch) {
      subtype = 'channel_id';
      channelId = channelMatch[1];
    } else if (playlistMatch) {
      subtype = 'playlist';
    } else if (userMatch) {
      subtype = 'user';
      handle = userMatch[1];
    }

    return {
      type: 'youtube',
      subtype: subtype,
      handle: handle,
      channelId: channelId,
      raw: input,
      normalized: normalized,
      badge: { label: 'YouTube', icon: '📺', color: '#ef4444' },
      target: handle ? `@${handle}` : (channelId || normalized)
    };
  }

  return null;
}

/**
 * Checks if input matches Reddit subreddit or user feed.
 */
function checkReddit(input) {
  // r/subreddit or u/username shorthand
  const subShorthand = /^r\/([a-zA-Z0-9_]+)$/i.exec(input);
  if (subShorthand) {
    const sub = subShorthand[1];
    return {
      type: 'reddit',
      subtype: 'subreddit',
      subreddit: sub,
      raw: input,
      normalized: `https://www.reddit.com/r/${sub}/.rss`,
      badge: { label: 'Reddit Subreddit', icon: '🔴', color: '#ff4500' },
      target: `r/${sub}`
    };
  }

  const userShorthand = /^u\/([a-zA-Z0-9_-]+)$/i.exec(input);
  if (userShorthand) {
    const user = userShorthand[1];
    return {
      type: 'reddit',
      subtype: 'user',
      username: user,
      raw: input,
      normalized: `https://www.reddit.com/user/${user}/.rss`,
      badge: { label: 'Reddit User', icon: '👤', color: '#ff4500' },
      target: `u/${user}`
    };
  }

  // Reddit full URLs
  const redditSubPattern = /^(https?:\/\/)?(www\.|old\.|new\.)?reddit\.com\/r\/([a-zA-Z0-9_]+)(\/.*)?$/i;
  const redditUserPattern = /^(https?:\/\/)?(www\.|old\.|new\.)?reddit\.com\/user\/([a-zA-Z0-9_-]+)(\/.*)?$/i;

  const subMatch = redditSubPattern.exec(input);
  if (subMatch) {
    const sub = subMatch[3];
    return {
      type: 'reddit',
      subtype: 'subreddit',
      subreddit: sub,
      raw: input,
      normalized: `https://www.reddit.com/r/${sub}/.rss`,
      badge: { label: 'Reddit Subreddit', icon: '🔴', color: '#ff4500' },
      target: `r/${sub}`
    };
  }

  const usrMatch = redditUserPattern.exec(input);
  if (usrMatch) {
    const user = usrMatch[3];
    return {
      type: 'reddit',
      subtype: 'user',
      username: user,
      raw: input,
      normalized: `https://www.reddit.com/user/${user}/.rss`,
      badge: { label: 'Reddit User', icon: '👤', color: '#ff4500' },
      target: `u/${user}`
    };
  }

  return null;
}

/**
 * Checks if input is an explicit RSS / Atom feed URL.
 */
function checkDirectRss(input) {
  if (!/^https?:\/\//i.test(input) && !TLD_REGEX.test(input)) return null;

  const lower = input.toLowerCase();
  const isFeedExt = /\.(rss|atom|xml)($|\?)/i.test(lower);
  const isFeedPath = /\/(feed|rss|rss\.xml|atom\.xml|index\.xml|feed\/)($|\?)/i.test(lower);
  const isFeedQuery = /(\?|&)(format=xml|feed=rss|output=atom|type=rss)/i.test(lower);

  if (isFeedExt || isFeedPath || isFeedQuery) {
    const normalized = input.startsWith('http') ? input : `https://${input}`;
    return {
      type: 'rss_atom',
      raw: input,
      normalized: normalized,
      badge: { label: 'Direct RSS Feed', icon: '⚡', color: '#f59e0b' },
      target: normalized
    };
  }

  return null;
}

/**
 * Checks if input is a standard website URL.
 */
function checkWebsite(input) {
  // If it starts with http:// or https://
  if (/^https?:\/\//i.test(input)) {
    return {
      type: 'website',
      raw: input,
      normalized: input,
      badge: { label: 'Website / Blog', icon: '🌐', color: '#0284c7' },
      target: input
    };
  }

  // If it has no spaces, contains a dot, and matches standard domain/TLD structure
  if (!/\s/.test(input) && TLD_REGEX.test(input)) {
    const normalized = `https://${input}`;
    return {
      type: 'website',
      raw: input,
      normalized: normalized,
      badge: { label: 'Website / Blog', icon: '🌐', color: '#0284c7' },
      target: normalized
    };
  }

  return null;
}
