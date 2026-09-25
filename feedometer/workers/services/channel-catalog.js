/**
 * workers/services/channel-catalog.js
 * --------------------------------------------------------------------------
 * PURPOSE (plain language)
 * --------------------------------------------------------------------------
 * Home and Top Stories used to ship two secrets in the HTML:
 *   1. The list of RSS URLs for each channel (Tech, World, …)
 *   2. The keyword rules that decide which tab a headline belongs on
 *
 * Those lists now live HERE on the Worker. The browser only asks for
 * GET /api/stream (optional ?channel=Tech) and filters using channel_tags
 * the API already computed.
 *
 * HOW TO READ THIS FILE
 *   - CHANNELS                 the five public news desks + their feeds
 *   - getChannelSources()      RSS sources for one desk, or all desks
 *   - tagItemChannels()        which tabs this headline should appear on
 *   - applyChannelTags()       stamp tags onto a stream result
 *   - filterStreamByChannel()  keep only items for one desk
 *
 * An article can appear on more than one tab (same as the old page logic).
 * Example: a "Google stock" story can be Tech AND Finance.
 */
'use strict';

export const CHANNELS = [
  {
    id: 'Tech',
    label: 'Technology & AI',
    keywordSource: 'tech|ai|artificial intelligence|software|hardware|apple|google|microsoft|nvidia|openai|code|computing|robot|cyber|app|developer|llm|cloud|semiconductor|chip|startup',
    sources: [
      { id: 'src_tc', title: 'TechCrunch', feed_url: 'https://techcrunch.com/feed/', category: 'Tech' },
      { id: 'src_hn', title: 'Hacker News', feed_url: 'https://news.ycombinator.com/rss', category: 'Tech' },
      { id: 'src_ars', title: 'Ars Technica', feed_url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'Tech' }
    ]
  },
  {
    id: 'Finance',
    label: 'Markets & Finance',
    keywordSource: 'market|finance|stock|wall street|inflation|bank|fed|invest|trade|fund|shares|economy|dollar|rate|revenue|profit|earnings|treasury|gdp|asset|business|billion|million',
    sources: [
      { id: 'src_yahoo_fin', title: 'Yahoo Finance', feed_url: 'https://finance.yahoo.com/news/rssindex', category: 'Finance' },
      { id: 'src_marketwatch', title: 'MarketWatch', feed_url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'Finance' },
      { id: 'src_cnbc', title: 'CNBC', feed_url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', category: 'Finance' }
    ]
  },
  {
    id: 'World',
    label: 'World News',
    keywordSource: 'world|global|international|bbc|reuters|war|peace|president|minister|ukraine|russia|israel|gaza|china|un |treaty|country|police|government|attack|mosque|pakistan|philippines',
    sources: [
      { id: 'src_bbc', title: 'BBC News', feed_url: 'http://feeds.bbci.co.uk/news/world/rss.xml', category: 'World' },
      { id: 'src_npr', title: 'NPR', feed_url: 'https://feeds.npr.org/1001/rss.xml', category: 'World' },
      { id: 'src_aljazeera', title: 'Al Jazeera', feed_url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'World' }
    ]
  },
  {
    id: 'Science',
    label: 'Science & Space',
    keywordSource: 'science|space|nasa|astronomy|physics|biology|climate|earth|moon|mars|planet|dna|quantum|health|study|research|telescope|species|solar|galaxy|medical|disease',
    sources: [
      { id: 'src_nasa', title: 'NASA', feed_url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', category: 'Science' },
      { id: 'src_space', title: 'Space.com', feed_url: 'https://www.space.com/feeds/all', category: 'Science' },
      { id: 'src_nature', title: 'Nature', feed_url: 'https://www.nature.com/nature.rss', category: 'Science' }
    ]
  },
  {
    id: 'Crypto',
    label: 'Crypto & Web3',
    keywordSource: 'crypto|bitcoin|ethereum|blockchain|btc|eth|token|web3|defi|binance|coin|wallet|nft|solana|mining|ledger|sec',
    sources: [
      { id: 'src_coindesk', title: 'CoinDesk', feed_url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'Crypto' },
      { id: 'src_cointelegraph', title: 'Cointelegraph', feed_url: 'https://cointelegraph.com/rss', category: 'Crypto' },
      { id: 'src_decrypt', title: 'Decrypt', feed_url: 'https://decrypt.co/feed', category: 'Crypto' }
    ]
  }
];

const CHANNEL_REGEX = CHANNELS.map((ch) => ({
  id: ch.id,
  regex: new RegExp(ch.keywordSource, 'i')
}));

/**
 * Turn "tech", "Technology & AI", or "Tech" into the canonical id "Tech".
 * "all" / empty means every desk.
 */
export function normalizeChannelId(raw) {
  const value = String(raw || '').trim();
  if (!value || /^all$/i.test(value)) return 'all';
  const lower = value.toLowerCase();
  const found = CHANNELS.find((ch) => {
    return ch.id.toLowerCase() === lower || ch.label.toLowerCase() === lower;
  });
  return found ? found.id : 'all';
}

/**
 * RSS sources for the public channel mix.
 * Pass "all" (or nothing) to get every desk; pass "Tech" for that desk only.
 */
export function getChannelSources(channelId) {
  const id = normalizeChannelId(channelId);
  if (id === 'all') {
    return CHANNELS.reduce((list, ch) => list.concat(ch.sources), []);
  }
  const ch = CHANNELS.find((c) => c.id === id);
  return ch ? ch.sources.slice() : [];
}

/**
 * Decide which Top Stories tabs this headline belongs on.
 * Matches the old browser regex, plus the feed's own category if present.
 */
export function tagItemChannels(item) {
  const sourceTitle = (item && item.source && item.source.title) || item.sourceTitle || item.source_title || '';
  const sourceCat = (item && item.source && item.source.category) || item.category || '';
  const text = [item && item.title, item && item.summary, item && item.snippet, sourceTitle].filter(Boolean).join(' ');
  const tags = [];

  CHANNEL_REGEX.forEach((ch) => {
    const fromKeywords = text && ch.regex.test(text);
    const fromSource = sourceCat && String(sourceCat).toLowerCase() === ch.id.toLowerCase();
    if (fromKeywords || fromSource) tags.push(ch.id);
  });

  return tags;
}

/**
 * Add channel_tags + a primary category on every item in a fused stream payload.
 */
export function applyChannelTags(streamResult) {
  if (!streamResult || !Array.isArray(streamResult.items)) return streamResult;
  streamResult.items = streamResult.items.map((item) => {
    const channel_tags = tagItemChannels(item);
    const category = channel_tags[0] || item.category || (item.source && item.source.category) || 'General';
    return Object.assign({}, item, { channel_tags, category });
  });
  return streamResult;
}

/**
 * Keep items that belong on one desk. "all" returns everything.
 */
export function filterStreamByChannel(streamResult, channelId) {
  const id = normalizeChannelId(channelId);
  if (!streamResult || id === 'all') return streamResult;
  const items = (streamResult.items || []).filter((item) => {
    const tags = item.channel_tags || [];
    return tags.indexOf(id) !== -1 || String(item.category || '').toLowerCase() === id.toLowerCase();
  });
  return Object.assign({}, streamResult, {
    items,
    count: items.length,
    channel: id
  });
}
