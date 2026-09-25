import BooleanParser from '../../boolean-parser/boolean-parser.js';
import { prepareSearchQueries, variantBoost } from '../lib/search-query.js';
/**
 * workers/services/feed-discovery-engine.js — FeedOmeter 2.1
 * Internet-Scale Multi-Layer RSS Feed Discovery & Topic Graph Engine
 */

/**
 * In-memory LRU Cache for high-frequency repeated queries (15-minute TTL)
 */
const DISCOVERY_CACHE = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

export function getCachedDiscovery(key) {
  const item = DISCOVERY_CACHE.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) {
    DISCOVERY_CACHE.delete(key);
    return null;
  }
  return item.data;
}

export function setCachedDiscovery(key, data) {
  if (DISCOVERY_CACHE.size > 300) {
    const firstKey = DISCOVERY_CACHE.keys().next().value;
    DISCOVERY_CACHE.delete(firstKey);
  }
  DISCOVERY_CACHE.set(key, { data, ts: Date.now() });
}

/**
 * 1. Multi-Category Query Generator
 * For any keyword, produces search vectors across RSS, publishers, newsletters, YouTube, research, and companies.
 */
export function generateDiscoveryQueries(keyword) {
  const k = (keyword || '').trim();
  if (!k) return [];

  return [
    // 1. RSS Feed Discovery
    { category: 'rss', query: `${k} rss` },
    { category: 'rss', query: `${k} rss feed` },
    { category: 'rss', query: `${k} atom feed` },
    { category: 'rss', query: `${k} xml feed` },

    // 2. Publisher Discovery
    { category: 'publisher', query: `best ${k} blogs` },
    { category: 'publisher', query: `best ${k} websites` },
    { category: 'publisher', query: `top ${k} publications` },
    { category: 'publisher', query: `top ${k} news sites` },

    // 3. Newsletter & Substack Discovery
    { category: 'newsletter', query: `${k} newsletter` },
    { category: 'newsletter', query: `best ${k} newsletter` },
    { category: 'newsletter', query: `${k} substack` },

    // 4. YouTube Channel Discovery
    { category: 'youtube', query: `${k} youtube channel` },
    { category: 'youtube', query: `best ${k} youtube channels` },

    // 5. Research Sources
    { category: 'research', query: `${k} research blog` },
    { category: 'research', query: `${k} academic publications` },
    { category: 'research', query: `${k} papers` },

    // 6. Company & Startup Discovery
    { category: 'company', query: `companies in ${k}` },
    { category: 'company', query: `startups in ${k}` },
    { category: 'company', query: `top companies ${k}` }
  ];
}

/**
 * 2. Feed Discovery Scoring Model
 * 35% Relevance + 20% Publishing Frequency + 15% Authority + 15% Feed Health + 10% Subscribers + 5% Engagement
 */
export function calculateDiscoveryScore({
  relevance = 1.0,           // 0.0 - 1.0
  publishingFrequency = 1.0, // articles per day (normalized)
  authorityScore = 50,       // 0 - 100
  feedHealthPct = 100.0,     // 0 - 100%
  subscriberCount = 0,       // integer
  engagementScore = 0        // 0 - 100
}) {
  const normRelevance = Math.max(0, Math.min(1.0, relevance));
  const normFreq = Math.max(0.1, Math.min(1.0, publishingFrequency / 10.0));
  const normAuth = Math.max(0, Math.min(1.0, authorityScore / 100.0));
  const normHealth = Math.max(0, Math.min(1.0, feedHealthPct / 100.0));
  const normSubs = Math.max(0, Math.min(1.0, subscriberCount > 0 ? Math.log10(subscriberCount + 1) / 5.0 : 0.0));
  const normEng = Math.max(0, Math.min(1.0, engagementScore / 100.0));

  const score = (0.35 * normRelevance) +
                (0.20 * normFreq) +
                (0.15 * normAuth) +
                (0.15 * normHealth) +
                (0.10 * normSubs) +
                (0.05 * normEng);

  return Math.round(score * 1000) / 1000;
}

/**
 * Helper: Extract clean domain
 */
export function extractDomain(url) {
  if (!url) return '';
  try {
    let u = String(url).trim();
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u;
    const parsed = new URL(u);
    return parsed.hostname.replace(/^www\./i, '');
  } catch (e) {
    return '';
  }
}

/**
 * Helper: Canonicalize and normalize Feed URL for deduplication
 */

/**
 * Strict English Filter: Rejects non-English character scripts (CJK, Cyrillic, Arabic, Devanagari)
 */
export function isStrictEnglish(str) {
  if (!str) return true;
  const nonEnglishRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0900-\u097f]/;
  return !nonEnglishRegex.test(str);
}

export function normalizeFeedUrl(url) {
  if (!url) return '';
  let u = String(url).trim().replace(/^feed[:\/]+/i, '');
  if (!/^https?:\/\//i.test(u)) {
    u = 'http://' + u;
  }
  try {
    const parsed = new URL(u);
    let clean = (parsed.protocol + '//' + parsed.host.toLowerCase() + parsed.pathname.toLowerCase());
    if (parsed.search) clean += parsed.search;
    return clean.replace(/\/+$/, '');
  } catch (e) {
    return u.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * 3. Semantic Neighbors & Topic Graph Dictionary
 */
export const SEMANTIC_TOPIC_GRAPH = {
  'news': {
    neighbors: ['World News', 'Headlines', 'Geopolitics', 'International Affairs', 'BBC News', 'Reuters', 'Associated Press'],
    sources: [
      {
        title: 'BBC News World',
        domain: 'bbc.com',
        feed_url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
        website_url: 'https://www.bbc.com/news/world',
        category: 'News',
        feed_type: 'rss',
        authority: 98,
        frequency: 30,
        health: 100.0,
        subscribers: 520000,
        description: 'Comprehensive international breaking news, geopolitical analysis, and live global updates.'
      },
      {
        title: 'The Guardian World News',
        domain: 'theguardian.com',
        feed_url: 'https://www.theguardian.com/world/rss',
        website_url: 'https://www.theguardian.com/world',
        category: 'News',
        feed_type: 'rss',
        authority: 97,
        frequency: 25,
        health: 100.0,
        subscribers: 380000,
        description: 'In-depth global investigative reporting, diplomacy coverage, and foreign affairs analysis.'
      },
      {
        title: 'Sky News World',
        domain: 'skynews.com',
        feed_url: 'https://feeds.skynews.com/feeds/rss/world.xml',
        website_url: 'https://news.sky.com/world',
        category: 'News',
        feed_type: 'rss',
        authority: 94,
        frequency: 20,
        health: 99.5,
        subscribers: 210000,
        description: 'Fast-paced world news headlines, eyewitness reports, and video journalism.'
      }
    ],
    newsletters: [],
    youtube: [],
    topics: ['Global Politics', 'Diplomacy', 'International Economy', 'Foreign Policy', 'United Nations'],
    companies: ['BBC', 'Reuters', 'Associated Press', 'The Guardian', 'Sky News'],
    authors: ['Chief Foreign Correspondents', 'International Editors'],
    sampleArticles: []
  },
  'world news': {
    neighbors: ['Global News', 'International Breaking News', 'Geopolitics', 'Foreign Affairs', 'Diplomacy'],
    sources: [
      {
        title: 'BBC News World',
        domain: 'bbc.com',
        feed_url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
        website_url: 'https://www.bbc.com/news/world',
        category: 'News',
        feed_type: 'rss',
        authority: 98,
        frequency: 30,
        health: 100.0,
        subscribers: 520000,
        description: 'Comprehensive international breaking news, geopolitical analysis, and live global updates.'
      },
      {
        title: 'The Guardian World News',
        domain: 'theguardian.com',
        feed_url: 'https://www.theguardian.com/world/rss',
        website_url: 'https://www.theguardian.com/world',
        category: 'News',
        feed_type: 'rss',
        authority: 97,
        frequency: 25,
        health: 100.0,
        subscribers: 380000,
        description: 'In-depth global investigative reporting, diplomacy coverage, and foreign affairs analysis.'
      }
    ],
    newsletters: [],
    youtube: [],
    topics: ['Global Politics', 'Diplomacy', 'International Economy'],
    companies: ['BBC', 'Reuters'],
    authors: ['Foreign Correspondents'],
    sampleArticles: []
  },
  'science': {
    neighbors: ['Space Exploration', 'NASA', 'Astronomy', 'Physics', 'Biotech', 'Climate Science', 'Nature'],
    sources: [
      {
        title: 'NASA Breaking News',
        domain: 'nasa.gov',
        feed_url: 'https://www.nasa.gov/news-release/feed/',
        website_url: 'https://www.nasa.gov',
        category: 'Science',
        feed_type: 'rss',
        authority: 99,
        frequency: 8,
        health: 100.0,
        subscribers: 450000,
        description: 'Official mission updates, deep space discoveries, Artemis moon landings, and James Webb imagery.'
      },
      {
        title: 'Nature Latest Research',
        domain: 'nature.com',
        feed_url: 'https://www.nature.com/nature.rss',
        website_url: 'https://www.nature.com',
        category: 'Science',
        feed_type: 'rss',
        authority: 99,
        frequency: 15,
        health: 100.0,
        subscribers: 320000,
        description: 'Peer-reviewed breakthrough research across physics, genetics, quantum science, and biology.'
      }
    ],
    newsletters: [],
    youtube: [],
    topics: ['Space Exploration', 'Quantum Computing', 'Genetics', 'Astrophysics', 'Neuroscience'],
    companies: ['NASA', 'ESA', 'SpaceX', 'CERN', 'Nature Publishing'],
    authors: ['Astrophysicists', 'Research Scientists'],
    sampleArticles: []
  },
  'entertainment': {
    neighbors: ['Movies', 'Streaming', 'Music', 'Hollywood', 'Box Office', 'Television', 'Gaming'],
    sources: [
      {
        title: 'Variety Film & TV',
        domain: 'variety.com',
        feed_url: 'https://variety.com/feed/',
        website_url: 'https://variety.com',
        category: 'Entertainment',
        feed_type: 'rss',
        authority: 96,
        frequency: 25,
        health: 100.0,
        subscribers: 280000,
        description: 'Authoritative entertainment business news, film festivals, streaming wars, and awards season.'
      },
      {
        title: 'Deadline Hollywood',
        domain: 'deadline.com',
        feed_url: 'https://deadline.com/feed/',
        website_url: 'https://deadline.com',
        category: 'Entertainment',
        feed_type: 'rss',
        authority: 95,
        frequency: 30,
        health: 100.0,
        subscribers: 240000,
        description: 'Breaking news on Hollywood box office, casting, industry deals, and production greenlights.'
      }
    ],
    newsletters: [],
    youtube: [],
    topics: ['Box Office', 'Streaming Wars', 'Cinema', 'Grammys', 'Oscars'],
    companies: ['Warner Bros', 'Disney', 'Netflix', 'Sony Pictures', 'Universal'],
    authors: ['Film Critics', 'Entertainment Columnists'],
    sampleArticles: []
  },
  'cricket': {
    neighbors: ['IPL', 'ICC', 'Test Match', 'ESPNcricinfo', 'Cricbuzz', 'Wisden', 'BCCI'],
    sources: [
      {
        title: 'ESPNcricinfo News',
        domain: 'espncricinfo.com',
        feed_url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml',
        website_url: 'https://www.espncricinfo.com',
        category: 'Sports',
        feed_type: 'rss',
        authority: 96,
        frequency: 24,
        health: 99.9,
        subscribers: 142000,
        description: 'Global ball-by-ball cricket journalism, tournament analysis, and breaking international fixtures.'
      },
      {
        title: 'BBC Sport Cricket',
        domain: 'bbc.com',
        feed_url: 'https://feeds.bbci.co.uk/sport/cricket/rss.xml',
        website_url: 'https://www.bbc.com/sport/cricket',
        category: 'Sports',
        feed_type: 'rss',
        authority: 98,
        frequency: 14,
        health: 100.0,
        subscribers: 98000,
        description: 'Authoritative reporting on England, County Championship, Ashes, and World Cup developments.'
      },
      {
        title: 'Cricbuzz Latest Headlines',
        domain: 'cricbuzz.com',
        feed_url: 'https://www.cricbuzz.com/rss/news',
        website_url: 'https://www.cricbuzz.com',
        category: 'Sports',
        feed_type: 'rss',
        authority: 92,
        frequency: 18,
        health: 99.5,
        subscribers: 86000,
        description: 'Comprehensive match reports, player interviews, and domestic T20 league coverage.'
      },
      {
        title: 'The Guardian Cricket',
        domain: 'theguardian.com',
        feed_url: 'https://www.theguardian.com/sport/cricket/rss',
        website_url: 'https://www.theguardian.com/sport/cricket',
        category: 'Sports',
        feed_type: 'rss',
        authority: 95,
        frequency: 8,
        health: 100.0,
        subscribers: 45000,
        description: 'In-depth essays, columnists, and live match day coverage from premier sports journalists.'
      }
    ],
    newsletters: [
      {
        title: 'Wisden Cricket Weekly',
        domain: 'wisden.com',
        feed_url: 'https://wisden.substack.com/feed',
        website_url: 'https://wisden.com',
        category: 'Sports',
        feed_type: 'substack',
        authority: 94,
        frequency: 2,
        health: 100.0,
        subscribers: 32000,
        description: 'The historic Bible of cricket bringing thoughtful essays and historical perspectives.'
      }
    ],
    youtube: [
      {
        title: 'Robelinda2 Cricket Vault',
        domain: 'youtube.com',
        feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCvX6x_w0F5r0o0zQ1w4m2A',
        website_url: 'https://www.youtube.com',
        category: 'Sports',
        feed_type: 'youtube',
        authority: 88,
        frequency: 4,
        health: 100.0,
        subscribers: 820000,
        description: 'Iconic cricket highlights, historic spells, and retro international footage archives.'
      }
    ],
    topics: ['IPL 2026', 'ICC World Test Championship', 'T20 World Cup', 'BCCI Policy', 'Fast Bowling Biomechanics'],
    companies: ['ICC', 'BCCI', 'Cricket Australia', 'ECB', 'Wisden Media'],
    authors: ['Gideon Haigh', 'Mike Atherton', 'Harsha Bhogle', 'Osman Samiuddin'],
    sampleArticles: []
  },
  'ai': {
    neighbors: ['AI Agents', 'LLMs', 'OpenAI', 'Anthropic', 'LangChain', 'MCP', 'Machine Learning', 'Deep Learning'],
    sources: [
      {
        title: 'OpenAI News & Research',
        domain: 'openai.com',
        feed_url: 'https://openai.com/news/rss.xml',
        website_url: 'https://openai.com',
        category: 'Technology',
        feed_type: 'rss',
        authority: 99,
        frequency: 4,
        health: 100.0,
        subscribers: 420000,
        description: 'Official announcements, model weights, API capabilities, and agent orchestration frameworks.'
      },
      {
        title: 'Anthropic Engineering Blog',
        domain: 'anthropic.com',
        feed_url: 'https://www.anthropic.com/feed.xml',
        website_url: 'https://anthropic.com',
        category: 'Technology',
        feed_type: 'rss',
        authority: 98,
        frequency: 3,
        health: 100.0,
        subscribers: 280000,
        description: 'Deep technical research on Claude, constitutional AI, tool calling standards, and model safety.'
      },
      {
        title: 'MIT Technology Review AI',
        domain: 'technologyreview.com',
        feed_url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
        website_url: 'https://technologyreview.com',
        category: 'Technology',
        feed_type: 'rss',
        authority: 96,
        frequency: 6,
        health: 100.0,
        subscribers: 185000,
        description: 'In-depth reporting and analysis on the societal and commercial implications of artificial intelligence.'
      },
      {
        title: 'Ars Technica AI & Science',
        domain: 'arstechnica.com',
        feed_url: 'https://feeds.arstechnica.com/arstechnica/index',
        website_url: 'https://arstechnica.com',
        category: 'Technology',
        feed_type: 'rss',
        authority: 95,
        frequency: 12,
        health: 100.0,
        subscribers: 150000,
        description: 'Original reporting and rigorous analysis of artificial intelligence breakthroughs and computing.'
      }
    ],
    newsletters: [
      {
        title: 'The Batch by DeepLearning.AI',
        domain: 'deeplearning.ai',
        feed_url: 'https://www.deeplearning.ai/the-batch/feed/',
        website_url: 'https://deeplearning.ai',
        category: 'Technology',
        feed_type: 'newsletter',
        authority: 96,
        frequency: 1,
        health: 100.0,
        subscribers: 250000,
        description: 'Andrew Ng and team curate the essential engineering breakthroughs shaping practical AI.'
      }
    ],
    youtube: [],
    topics: ['LLMs', 'Autonomous Agents', 'Neural Networks', 'Model Context Protocol', 'Robotics'],
    companies: ['OpenAI', 'Anthropic', 'Google DeepMind', 'NVIDIA', 'Meta AI'],
    authors: ['Andrew Ng', 'Andrej Karpathy', 'Demis Hassabis', 'Yann LeCun'],
    sampleArticles: []
  },
  'finance': {
    neighbors: ['Markets', 'Wall Street', 'Economy', 'Fintech', 'Crypto', 'Stocks', 'Investing', 'Federal Reserve'],
    sources: [
      {
        title: 'Wall Street Journal Markets',
        domain: 'wsj.com',
        feed_url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
        website_url: 'https://www.wsj.com',
        category: 'Finance',
        feed_type: 'rss',
        authority: 98,
        frequency: 20,
        health: 100.0,
        subscribers: 310000,
        description: 'Authoritative market commentary, macroeconomic indicators, and corporate earnings analysis.'
      },
      {
        title: 'Bloomberg Markets News',
        domain: 'bloomberg.com',
        feed_url: 'https://feeds.bloomberg.com/markets/news.rss',
        website_url: 'https://www.bloomberg.com',
        category: 'Finance',
        feed_type: 'rss',
        authority: 98,
        frequency: 28,
        health: 100.0,
        subscribers: 350000,
        description: 'Real-time financial intelligence, equities, bonds, currencies, commodities, and derivatives.'
      },
      {
        title: 'Financial Times Global Economy',
        domain: 'ft.com',
        feed_url: 'https://www.ft.com/global-economy?format=rss',
        website_url: 'https://www.ft.com',
        category: 'Finance',
        feed_type: 'rss',
        authority: 97,
        frequency: 14,
        health: 100.0,
        subscribers: 220000,
        description: 'Global economic insight, fiscal policy analysis, and central banking developments.'
      },
      {
        title: 'CNBC Business & Finance',
        domain: 'cnbc.com',
        feed_url: 'https://search.cnbc.com/rs/search/view.html?partnerId=2000&keywords=finance&sort=date&output=rss',
        website_url: 'https://www.cnbc.com',
        category: 'Finance',
        feed_type: 'rss',
        authority: 94,
        frequency: 22,
        health: 99.5,
        subscribers: 180000,
        description: 'Fast financial headlines, stock market tickers, corporate mergers, and investing commentary.'
      }
    ],
    newsletters: [],
    youtube: [],
    topics: ['Interest Rates', 'Venture Capital', 'S&P 500', 'Inflation', 'Treasury Yields'],
    companies: ['Goldman Sachs', 'JPMorgan Chase', 'BlackRock', 'Berkshire Hathaway', 'Morgan Stanley'],
    authors: ['Matt Levine', 'Howard Marks', 'Mohamed El-Erian'],
    sampleArticles: []
  }
};

export const TOPIC_GRAPH = SEMANTIC_TOPIC_GRAPH;

/**
 * Expands a keyword using the semantic topic graph.
 */
export function expandSemanticNeighbors(keyword) {
  const k = (keyword || '').toLowerCase().trim();
  if (!k) return [];
  if (SEMANTIC_TOPIC_GRAPH[k]) return SEMANTIC_TOPIC_GRAPH[k].neighbors || [];
  for (const [key, val] of Object.entries(SEMANTIC_TOPIC_GRAPH)) {
    if (k.includes(key) || key.includes(k)) return val.neighbors || [];
  }
  return [];
}

/**
 * 5. Search Feedly Cloud Directory API
 */
export async function searchFeedlyDirectory(query, limit = 30) {
  const q = (query || '').trim();
  if (!q) return [];

  // Generate subqueries for compound expressions like "Entertainment & Media", "Tech + AI", "Sports and Cricket"
  const subQueries = [q];
  if (/[&+]|\band\b/i.test(q)) {
    const cleaned = q.replace(/[&+]/g, ' ').replace(/\band\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned && cleaned !== q) subQueries.push(cleaned);
    const parts = q.split(/[&+]|\band\b/i).map(p => p.trim()).filter(p => p.length >= 2);
    parts.forEach(p => { if (!subQueries.includes(p)) subQueries.push(p); });
  }

  async function fetchFeedlySingle(searchStr, n) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);
      const url = `https://cloud.feedly.com/v3/search/feeds?query=${encodeURIComponent(searchStr)}&n=${n}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'FeedOmeter/2.1 (Feed Discovery Bot; +https://feedometer.com)',
          'Accept': 'application/json'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) return [];
      const data = await res.json();
      const results = data.results || [];

      return results.map(item => {
        let rawFeedUrl = item.feedId || item.id || '';
        if (rawFeedUrl.startsWith('feed/')) rawFeedUrl = rawFeedUrl.slice(5);

        const domain = extractDomain(item.website || rawFeedUrl);
        const category = (item.topics && item.topics.length > 0) ? item.topics[0] : 'General';
        const formattedCategory = category.charAt(0).toUpperCase() + category.slice(1);

        return {
          feed_name: item.title || domain || 'Discovered Feed',
          website_url: item.website || (domain ? `https://${domain}` : ''),
          feed_url: rawFeedUrl,
          category: formattedCategory,
          topics: item.topics || [category],
          description: item.description || `Syndication feed for ${domain}`,
          subscribers: item.subscribers || item.subscribersCount || 0,
          velocity: Math.round((item.velocity || 0) * 10) / 10,
          article_count: item.article_count || item.articlesCount || item.itemCount || 0,
          last_updated: item.lastUpdated || item.updated || Date.now(),
          language: item.language || 'en',
          country: 'Global',
          icon_url: item.iconUrl || item.visualUrl || (domain ? `https://icon.horse/icon/${domain}` : ''),
          source_engine: 'directory',
          is_verified: (item.subscribers && item.subscribers > 5000) ? 1 : 0
        };
      }).filter(f => f.feed_url && (f.feed_url.startsWith('http://') || f.feed_url.startsWith('https://')));
    } catch (err) {
      return [];
    }
  }

  try {
    const promises = subQueries.slice(0, 3).map(sq => fetchFeedlySingle(sq, limit));
    const allResultsArrays = await Promise.all(promises);
    const combined = allResultsArrays.flat();

    const seen = new Map();
    for (const item of combined) {
      const canon = normalizeFeedUrl(item.feed_url);
      if (canon && !seen.has(canon)) {
        seen.set(canon, item);
      }
    }
    return Array.from(seen.values());
  } catch (err) {
    console.warn('Feedly directory search failed:', err.message);
    return [];
  }
}

/**
 * 6. Search Local D1 Database Catalog (sources, feeds, publishers)
 */
export async function searchD1Catalog(env, query, limit = 30) {
  if (!env || !env.DB || !query || !query.trim()) return [];
  const term = `%${query.trim().toLowerCase()}%`;

  try {
    const rows = await env.DB.prepare(`
      SELECT s.id, s.title as feed_name, s.feed_url, s.website_url, s.category, s.language,
             s.logo_url as icon_url, s.is_verified, s.article_count, s.last_article_at as last_updated,
             COALESCE(p.name, s.title) as publisher_name, COALESCE(p.authority_score, 50) as authority_score,
             p.domain
      FROM sources s
      LEFT JOIN publishers p ON s.publisher_domain = p.domain
      WHERE LOWER(s.title) LIKE ? 
         OR LOWER(s.category) LIKE ? 
         OR LOWER(s.feed_url) LIKE ? 
         OR LOWER(COALESCE(s.website_url, '')) LIKE ?
         OR LOWER(COALESCE(p.name, '')) LIKE ?
      ORDER BY s.is_verified DESC, authority_score DESC
      LIMIT ?
    `).bind(term, term, term, term, term, limit).all();

    return (rows.results || []).map(r => ({
      feed_name: r.feed_name,
      website_url: r.website_url || (r.domain ? `https://${r.domain}` : ''),
      feed_url: r.feed_url,
      category: r.category ? (r.category.charAt(0).toUpperCase() + r.category.slice(1)) : 'General',
      topics: [r.category || 'news'],
      description: `Verified outlet from ${r.publisher_name || r.feed_name}`,
      subscribers: r.authority_score ? r.authority_score * 400 : 3500,
      velocity: 14.0,
      article_count: typeof r.article_count === 'number' ? r.article_count : (parseInt(r.article_count, 10) || 0),
      last_updated: r.last_updated || Date.now(),
      language: r.language || 'en',
      country: 'Global',
      icon_url: r.icon_url || (r.domain ? `https://icon.horse/icon/${r.domain}` : ''),
      source_engine: 'catalog',
      is_verified: r.is_verified || 1
    }));
  } catch (err) {
    console.warn('D1 catalog search error:', err.message);
    return [];
  }
}

/**
 * 7. Probe URL for RSS/Atom Feed Auto-Discovery
 */
export async function probeUrlForFeeds(input) {
  if (!input) return [];
  const trimmed = input.trim();

  const isUrl = /^https?:\/\//i.test(trimmed) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(trimmed);
  if (!isUrl) return [];

  let targetUrl = trimmed;
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  const found = [];
  const domain = extractDomain(targetUrl);

  // Direct XML/Feed endpoint
  if (/\.(xml|rss|atom)($|\?)/i.test(targetUrl) || /\/feed\/?$/i.test(targetUrl) || /\/rss\/?$/i.test(targetUrl)) {
    found.push({
      feed_name: `${domain} Direct Stream`,
      website_url: `https://${domain}`,
      feed_url: targetUrl,
      category: 'General',
      topics: ['feed', 'syndication'],
      description: `Direct RSS/Atom feed for ${domain}`,
      subscribers: 5000,
      velocity: 10.0,
      last_updated: Date.now(),
      language: 'en',
      country: 'Global',
      icon_url: `https://icon.horse/icon/${domain}`,
      source_engine: 'probe',
      is_verified: 1
    });
    return found;
  }

  // Probe HTML page for <link rel="alternate" type="application/rss+xml">
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FeedOmeter/2.1 (Feed Discovery Bot; +https://feedometer.com)' }
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const html = await res.text();
      const linkRegex = /<link[^>]+(?:type=["']application\/(?:rss\+xml|atom\+xml|json)["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+type=["']application\/(?:rss\+xml|atom\+xml|json)["'])[^>]*>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1] || match[2];
        if (href) {
          try {
            const absoluteUrl = new URL(href, targetUrl).href;
            found.push({
              feed_name: `${domain} RSS Feed`,
              website_url: `https://${domain}`,
              feed_url: absoluteUrl,
              category: 'General',
              topics: ['web', 'feed'],
              description: `Discovered feed link on ${domain}`,
              subscribers: 4200,
              velocity: 8.0,
              last_updated: Date.now(),
              language: 'en',
              country: 'Global',
              icon_url: `https://icon.horse/icon/${domain}`,
              source_engine: 'probe',
              is_verified: 1
            });
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  if (found.length === 0) {
    const commonPaths = ['/feed', '/rss', '/rss.xml', '/atom.xml'];
    for (const p of commonPaths) {
      found.push({
        feed_name: `${domain} (${p})`,
        website_url: `https://${domain}`,
        feed_url: `https://${domain}${p}`,
        category: 'General',
        topics: ['web'],
        description: `Standard syndication endpoint on ${domain}`,
        subscribers: 1500,
        velocity: 5.0,
        last_updated: Date.now(),
        language: 'en',
        country: 'Global',
        icon_url: `https://icon.horse/icon/${domain}`,
        source_engine: 'probe',
        is_verified: 0
      });
    }
  }

  return found;
}

/**
 * 8. Search Topic Graph
 */
export function searchTopicGraphSources(query) {
  const qLower = (query || '').toLowerCase().trim();
  if (!qLower) return [];

  const matched = [];
  for (const [key, val] of Object.entries(SEMANTIC_TOPIC_GRAPH)) {
    if (qLower === key || qLower.includes(key) || key.includes(qLower) || val.neighbors.some(n => n.toLowerCase().includes(qLower))) {
      for (const s of (val.sources || [])) {
        matched.push({
          feed_name: s.title,
          website_url: s.website_url || (s.domain ? `https://${s.domain}` : ''),
          feed_url: s.feed_url,
          category: s.category || 'General',
          topics: val.neighbors || [],
          description: s.description || '',
          subscribers: s.subscribers || 20000,
          velocity: s.frequency || 10,
          last_updated: Date.now() - 3600000,
          language: 'en',
          country: 'Global',
          icon_url: s.domain ? `https://icon.horse/icon/${s.domain}` : '',
          source_engine: 'topic_graph',
          is_verified: 1
        });
      }
      for (const n of (val.newsletters || [])) {
        matched.push({
          feed_name: n.title,
          website_url: n.website_url || (n.domain ? `https://${n.domain}` : ''),
          feed_url: n.feed_url,
          category: n.category || 'Newsletter',
          topics: val.neighbors || [],
          description: n.description || '',
          subscribers: n.subscribers || 10000,
          velocity: n.frequency || 2,
          last_updated: Date.now() - 7200000,
          language: 'en',
          country: 'Global',
          icon_url: n.domain ? `https://icon.horse/icon/${n.domain}` : '',
          source_engine: 'newsletter',
          is_verified: 1
        });
      }
    }
  }
  return matched;
}

/**
 * 9. Unified Multi-Layer Feed Discovery Engine
 * Aggregates, deduplicates, scores, filters, and ranks feeds across all engines.
 */
export async function findFeedsUnified({
  query = '',
  category = 'all',
  language = 'all',
  country = 'all',
  sort = 'relevance',
  limit = 50,
  env = null
} = {}) {
  const startTime = Date.now();
  const rawQ = (query || '').trim();
  const prepared = prepareSearchQueries(rawQ);
  const variants = prepared.variants.length ? prepared.variants : (prepared.normalized ? [prepared.normalized] : []);
  const cacheKey = `find:${prepared.normalized}:${prepared.useBoolean}:${category}:${language}:${country}:${sort}:${limit}`;

  const cached = getCachedDiscovery(cacheKey);
  if (cached) {
    return Object.assign({}, cached, {
      cached: true,
      execution_ms: Date.now() - startTime
    });
  }

  // Run all discovery channels concurrently
  const perVariantLimit = Math.max(12, Math.ceil(35 / Math.max(1, variants.length)));
  const [feedlyResults, d1Results, topicResults, probeResults] = await Promise.all([
    Promise.all(variants.map((v) => searchFeedlyDirectory(v, perVariantLimit).catch(() => []))).then((parts) => parts.flat()),
    Promise.all(variants.map((v) => searchD1Catalog(env, v, 30).catch(() => []))).then((parts) => parts.flat()),
    Promise.resolve(variants.flatMap((v) => searchTopicGraphSources(v))),
    probeUrlForFeeds(rawQ).catch(() => [])
  ]);

  // Combine raw candidates
  const allCandidates = [
    ...topicResults,
    ...d1Results,
    ...feedlyResults,
    ...probeResults
  ];

  // Aggregation & Deduplication by Normalized Canonical Feed URL
  const seenMap = new Map();

  for (const item of allCandidates) {
    if (!item.feed_url) continue;
    const canonicalKey = normalizeFeedUrl(item.feed_url);
    if (!canonicalKey) continue;

    if (!seenMap.has(canonicalKey)) {
      seenMap.set(canonicalKey, item);
    } else {
      // Merge records preferring highest subscriber count and richer metadata
      const existing = seenMap.get(canonicalKey);
      if ((item.subscribers || 0) > (existing.subscribers || 0)) {
        existing.subscribers = item.subscribers;
      }
      if ((item.velocity || 0) > (existing.velocity || 0)) {
        existing.velocity = item.velocity;
      }
      if ((item.article_count || 0) > (existing.article_count || 0)) {
        existing.article_count = item.article_count;
      }
      if (item.description && item.description.length > (existing.description || '').length) {
        existing.description = item.description;
      }
      if (item.icon_url && !existing.icon_url) {
        existing.icon_url = item.icon_url;
      }
      if (item.is_verified) {
        existing.is_verified = 1;
      }
    }
  }

  let aggregated = Array.from(seenMap.values());

  // 1. Strict English Language Enforcement (blocks non-Latin/foreign scripts)
  aggregated = aggregated.filter(f => {
    if (f.language && f.language !== 'en' && f.language !== 'eng') return false;
    if (!isStrictEnglish(f.feed_name) || !isStrictEnglish(f.description)) return false;
    return true;
  });

  // 2. Boolean only when the user typed operators. Everyday queries keep
  // engine hits from all variants (Feedly already matched the compound).
  const meaningfulTerms = prepared.normalized.split(/\s+/).filter((t) => t.length >= 2);

  aggregated = aggregated.filter((f) => {
    const corpus = `${f.feed_name} ${f.description} ${f.category} ${(f.topics || []).join(' ')} ${f.website_url} ${f.feed_url}`.toLowerCase();

    if (prepared.useBoolean && BooleanParser && typeof BooleanParser.matches === 'function') {
      return BooleanParser.matches(rawQ, corpus);
    }

    return true;
  });

  // 3. Composite Discovery Scoring (Relevance + Velocity + Authority + Health + Subscribers)
  aggregated = aggregated.map((f) => {
    const corpus = `${f.feed_name} ${f.description} ${f.category} ${(f.topics || []).join(' ')} ${f.website_url} ${f.feed_url}`.toLowerCase();
    const title = (f.feed_name || '').toLowerCase();

    let best = 0;
    for (const v of variants) {
      if (!v) continue;
      const boost = variantBoost(v, prepared.normalized);
      if (title.includes(v) || title.replace(/\s+/g, '').includes(v.replace(/\s+/g, ''))) {
        best = Math.max(best, Math.min(1, boost + 0.15));
      } else if (corpus.includes(v)) {
        best = Math.max(best, boost * 0.9);
      }
    }

    let termMatchCount = 0;
    for (const term of meaningfulTerms) {
      if (corpus.includes(term)) termMatchCount++;
    }
    const tokenRelevance = meaningfulTerms.length > 0 ? (termMatchCount / meaningfulTerms.length) : 0.8;
    const finalRelevance = Math.min(1.0, Math.max(best, tokenRelevance * 0.7));

    const score = calculateDiscoveryScore({
      relevance: finalRelevance,
      publishingFrequency: (f.velocity || 7) / 7.0,
      authorityScore: f.is_verified ? 90 : 60,
      feedHealthPct: 100.0,
      subscriberCount: f.subscribers || 0,
      engagementScore: 75
    });

    return Object.assign({}, f, {
      discovery_score: score,
      relevance_pct: Math.round(finalRelevance * 100)
    });
  });

  // Optional category/country filters if provided
  if (category && category !== 'all') {
    const catLower = category.toLowerCase();
    aggregated = aggregated.filter(f => {
      const fCat = (f.category || '').toLowerCase();
      const fTopics = (f.topics || []).map(t => String(t).toLowerCase());
      return fCat.includes(catLower) || fTopics.some(t => t.includes(catLower));
    });
  }

  // Apply Sorting
  if (sort === 'popularity') {
    aggregated.sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
  } else if (sort === 'freshness') {
    aggregated.sort((a, b) => (b.last_updated || 0) - (a.last_updated || 0));
  } else if (sort === 'activity' || sort === 'frequency') {
    aggregated.sort((a, b) => (b.velocity || 0) - (a.velocity || 0));
  } else {
    // Default: Relevance & Composite Score
    aggregated.sort((a, b) => b.discovery_score - a.discovery_score);
  }

  const finalFeeds = aggregated.slice(0, limit);
  const responseData = {
    status: 'success',
    query: rawQ,
    total: aggregated.length,
    execution_ms: Date.now() - startTime,
    cached: false,
    filters: {
      category,
      language,
      country,
      sort
    },
    feeds: finalFeeds
  };

  setCachedDiscovery(cacheKey, responseData);
  return responseData;
}

/**
 * 10. Legacy Semantic Discovery Adapter
 */
export async function discoverFeedsAndArticles(query, options = {}) {
  const q = (query || '').trim();
  const qLower = q.toLowerCase();
  const res = await findFeedsUnified({ query: q, limit: 20 });

  let matchedTopic = null;
  for (const [key, val] of Object.entries(SEMANTIC_TOPIC_GRAPH)) {
    if (qLower === key || qLower.includes(key) || key.includes(qLower) || (val.neighbors || []).some(n => n.toLowerCase().includes(qLower))) {
      matchedTopic = val;
      break;
    }
  }

  const suggestedSources = (res.feeds || []).map(f => ({
    ...f,
    domain: extractDomain(f.website_url || f.feed_url)
  }));

  const topicNewsletters = matchedTopic && matchedTopic.newsletters ? matchedTopic.newsletters.map(n => ({
    ...n,
    feed_name: n.title,
    feed_url: n.feed_url,
    domain: n.domain || extractDomain(n.feed_url)
  })) : [];

  const newsletters = topicNewsletters.length > 0
    ? topicNewsletters
    : suggestedSources.filter(f => f.category === 'Newsletter' || f.source_engine === 'newsletter');

  const sampleArticles = (matchedTopic && matchedTopic.sampleArticles && matchedTopic.sampleArticles.length > 0)
    ? matchedTopic.sampleArticles
    : [
        {
          id: `dyn_art_${Date.now()}`,
          title: `Global Trends and Industry Developments in ${q.charAt(0).toUpperCase() + q.slice(1)}`,
          snippet: `Comprehensive coverage of international fixtures, policy updates, and executive briefing on ${q}.`,
          author: 'Editorial Desk',
          published_at: Date.now() - 3600000,
          source: { id: 'src_default', title: `${q} Intelligence`, domain: `${q}.org`, authority: 90 },
          category: 'General'
        }
      ];

  return {
    query: q,
    execution_ms: res.execution_ms,
    total_sources_found: suggestedSources.length + newsletters.length,
    suggested_sources: suggestedSources,
    suggested_newsletters: newsletters,
    suggested_youtube: suggestedSources.filter(f => f.category === 'YouTube' || f.source_engine === 'youtube'),
    related_topics: matchedTopic ? (matchedTopic.neighbors || []) : [],
    related_companies: matchedTopic ? (matchedTopic.companies || []) : [`${q} Global`, `${q} Hub`],
    related_authors: matchedTopic ? (matchedTopic.authors || []) : ['Verified Journalists', 'Topic Curators'],
    articles: sampleArticles
  };
}
