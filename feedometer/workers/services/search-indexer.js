/**
 * workers/services/search-indexer.js — Search Indexer & Ranking Calculations
 * Handles FTS5 indexing, query translation, and precision hybrid ranking for Cloudflare D1
 */

/**
 * Converts user search query into safe, valid SQLite FTS5 MATCH syntax.
 * Handles:
 *   - "exact phrases" -> "exact phrases"
 *   - -term or NOT term -> NOT term
 *   - term1 OR term2 -> term1 OR term2
 *   - term1 term2 -> term1 AND term2 (implicit AND)
 */
export function buildFtsQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return '';
  const trimmed = rawQuery.trim();
  if (!trimmed) return '';

  // Extract quoted phrases
  const phrases = [];
  let sanitized = trimmed.replace(/"([^"]+)"/g, (match, phrase) => {
    const cleanPhrase = phrase.trim().replace(/[^a-zA-Z0-9\s]/g, ' ');
    if (cleanPhrase) {
      phrases.push(`"${cleanPhrase}"`);
      return ` __PHRASE_${phrases.length - 1}__ `;
    }
    return '';
  });

  // Normalize operators
  sanitized = sanitized.replace(/\s+NOT\s+/gi, ' NOT ');
  sanitized = sanitized.replace(/\s+OR\s+/gi, ' OR ');
  sanitized = sanitized.replace(/\s+AND\s+/gi, ' AND ');
  // Handle -exclusion prefix: e.g. -crypto -> NOT crypto
  sanitized = sanitized.replace(/(?:^|\s)-([a-zA-Z0-9_]+)/g, ' NOT $1');

  // Tokenize remaining terms
  const tokens = sanitized.split(/\s+/).filter(Boolean);
  const clauses = [];
  let pendingNot = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'OR') {
      if (clauses.length > 0 && clauses[clauses.length - 1] !== 'OR') {
        clauses.push('OR');
      }
      continue;
    }
    if (token === 'NOT') {
      pendingNot = true;
      continue;
    }
    if (token === 'AND') {
      continue;
    }

    // Check if placeholder for phrase
    const phraseMatch = token.match(/__PHRASE_(\d+)__/);
    let term = phraseMatch ? phrases[parseInt(phraseMatch[1], 10)] : token.replace(/[^a-zA-Z0-9_*]/g, '');
    if (!term) continue;

    if (pendingNot) {
      clauses.push(`NOT ${term}`);
      pendingNot = false;
    } else {
      clauses.push(term);
    }
  }

  if (clauses.length === 0) return '';

  // Assemble with AND conjunction unless preceded by OR
  const resultParts = [];
  for (let i = 0; i < clauses.length; i++) {
    const curr = clauses[i];
    if (curr === 'OR') {
      resultParts.push('OR');
    } else {
      if (resultParts.length > 0 && resultParts[resultParts.length - 1] !== 'OR' && !curr.startsWith('NOT')) {
        resultParts.push('AND');
      }
      resultParts.push(curr);
    }
  }

  return resultParts.join(' ');
}

/**
 * Precision-First 4-Factor Composite Ranking Formula:
 * Final Score = 0.50 * BM25 + 0.20 * Freshness + 0.15 * Authority + 0.15 * Engagement
 */
export function calculateRankingScore({ bm25Rank = 0, publishedAt = Date.now(), authorityScore = 50, engagementScore = 0 }) {
  // 1. BM25 Normalized (FTS5 rank is negative in SQLite: lower is better, e.g. -12.5)
  // Convert to positive 0..1 scale
  const rawBm25 = Math.abs(bm25Rank);
  const normBm25 = Math.min(1.0, rawBm25 / 15.0);

  // 2. Exponential Freshness Decay (e^-lambda*dt)
  const now = Date.now();
  const ageHours = Math.max(0, (now - publishedAt) / (3600 * 1000));
  let freshness = 0.25;
  if (ageHours <= 6) freshness = 1.0;
  else if (ageHours <= 24) freshness = 0.85;
  else if (ageHours <= 72) freshness = 0.60;
  else if (ageHours <= 720) freshness = 0.35;

  // 3. Publisher Authority (0..1)
  const normAuthority = Math.min(1.0, Math.max(0.1, authorityScore / 100.0));

  // 4. Engagement Score (0..1)
  const normEngagement = Math.min(1.0, Math.max(0, engagementScore / 100.0));

  // Final Composite Score (0.0 to 1.0)
  const finalScore = (0.50 * normBm25) + (0.20 * freshness) + (0.15 * normAuthority) + (0.15 * normEngagement);
  return Math.round(finalScore * 1000) / 1000;
}

/**
 * Generates transparent "Why this result?" explanation badges
 */
export function generateWhyBadges(article, rawQuery) {
  const badges = [];
  const queryLower = (rawQuery || '').toLowerCase();
  const titleLower = (article.title || '').toLowerCase();
  const snippetLower = (article.snippet || '').toLowerCase();

  // 1. Exact Match in Title
  const terms = queryLower.split(/\s+/).filter(t => t.length > 2 && !['and', 'or', 'not'].includes(t));
  const hasTitleMatch = terms.some(t => titleLower.includes(t));
  if (hasTitleMatch) {
    badges.push({ label: 'Exact match in title', type: 'highlight' });
  } else if (terms.some(t => snippetLower.includes(t))) {
    badges.push({ label: 'Matched in snippet', type: 'highlight' });
  }

  // 2. Verified Authority
  const auth = article.authority_score || 50;
  if (auth >= 85) {
    badges.push({ label: `Verified Source (${auth})`, type: 'verified' });
  }

  // 3. Freshness Indicator
  const ageHours = (Date.now() - (article.published_at || Date.now())) / (3600 * 1000);
  if (ageHours <= 6) {
    badges.push({ label: 'Breaking News (<6h)', type: 'trending' });
  }

  return badges;
}

/**
 * Inserts or updates an article into the D1 FTS5 article_search table
 */
export async function indexArticleInSearch(env, article) {
  if (!env.DB || !article || !article.id) return;

  try {
    const publishedAt = article.published_at || Date.now();
    const language = article.language || 'en';
    const title = article.title || 'Untitled Article';
    const author = article.author || '';
    const snippet = (article.snippet || '').slice(0, 1000);
    const sourceName = article.source_title || article.source_name || '';
    const category = article.category || 'general';

    // Insert into FTS5
    await env.DB.prepare(`
      INSERT INTO article_search (article_id, published_at, language, title, author, snippet, source_name, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(article.id, publishedAt, language, title, author, snippet, sourceName, category).run();

    // Seed top suggestions if title is substantial
    const titleWords = title.split(/\s+/).filter(w => w.length > 3 && /^[A-Z]/.test(w));
    for (const word of titleWords.slice(0, 2)) {
      await env.DB.prepare(`
        INSERT INTO search_suggestions (term, search_count, click_count, updated_at)
        VALUES (?, 1, 0, ?)
        ON CONFLICT(term) DO UPDATE SET search_count = search_count + 1, updated_at = excluded.updated_at
      `).bind(word, Date.now()).run();
    }
  } catch (e) {
    console.error('FTS Indexing error:', e.message);
  }
}
