/**
 * workers/modules/search.js — FeedOmeter 2.1 Search & News Discovery Intelligence Subsystem
 * Cloudflare D1 Relational Engine & SQLite FTS5 Full-Text Search
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { prepareSearchQueries } from '../lib/search-query.js';
import {
  buildFtsQuery,
  calculateRankingScore,
  generateWhyBadges
} from '../services/search-indexer.js';

/**
 * GET /api/search — Global Multi-Source Discovery Search
 */
export async function handleSearch(request, url, env, ctx) {
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  const rawQuery = (url.searchParams.get('q') || '').trim();
  const category = (url.searchParams.get('cat') || 'all').trim().toLowerCase();
  const language = (url.searchParams.get('lang') || 'all').trim().toLowerCase();
  const timeFilter = (url.searchParams.get('time') || 'all').trim().toLowerCase();
  const sortOrder = (url.searchParams.get('sort') || 'relevance').trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10)));
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const offset = (page - 1) * limit;

  const startTime = Date.now();
  const session = await verifySessionToken(request, env).catch(() => null);
  const userId = session ? session.userId : null;

  try {
    let stories = [];
    let totalCount = 0;

    if (!rawQuery) {
      // Zero-State: Return breaking / top authority verified articles
      const rows = await env.DB.prepare(`
        SELECT a.id, a.title, a.author, a.snippet, a.url, a.image_url, a.published_at,
               s.id as source_id, s.title as source_title, s.category,
               50 as authority_score, p.domain as publisher_domain
        FROM articles a
        JOIN sources s ON a.source_id = s.id
        LEFT JOIN publishers p ON s.publisher_domain = p.domain
        ORDER BY a.published_at DESC
        LIMIT ? OFFSET ?
      `).bind(limit, offset).all();

      stories = (rows.results || []).map(row => ({
        id: row.id,
        title: row.title,
        author: row.author,
        snippet: row.snippet,
        url: row.url,
        image_url: row.image_url,
        published_at: row.published_at,
        source: {
          id: row.source_id,
          title: row.source_title,
          category: row.category,
          domain: row.publisher_domain,
          authority: row.authority_score
        },
        ranking_score: 1.0,
        why_badges: generateWhyBadges(row, '')
      }));

      totalCount = stories.length;

    } else {
      let rawCandidates = [];
      const prepared = prepareSearchQueries(rawQuery);
      let ftsQuery = '';
      if (prepared.useBoolean) {
        ftsQuery = buildFtsQuery(rawQuery);
      } else {
        const parts = prepared.variants.map((v) => {
          if (/\s/.test(v)) return '"' + v.replace(/"/g, '') + '"';
          return v.replace(/[^a-zA-Z0-9_*]/g, '');
        }).filter(Boolean);
        ftsQuery = parts.join(' OR ');
      }
      try {
        if (!ftsQuery) {
          return jsonResponse({ status: 'success', total: 0, execution_ms: 1, items: [] });
        }
        let filterSql = '';
        const params = [ftsQuery];
        if (category !== 'all') {
          filterSql += ' AND s.category = ?';
          params.push(category);
        }
        if (timeFilter === '24h') {
          filterSql += ' AND a.published_at >= ?';
          params.push(Date.now() - 24 * 3600 * 1000);
        } else if (timeFilter === '7d') {
          filterSql += ' AND a.published_at >= ?';
          params.push(Date.now() - 7 * 24 * 3600 * 1000);
        } else if (timeFilter === '30d') {
          filterSql += ' AND a.published_at >= ?';
          params.push(Date.now() - 30 * 24 * 3600 * 1000);
        }
        const candidateLimit = limit * 2;
        params.push(candidateLimit);
        const candidateQuery = `
          SELECT fs.article_id, bm25(article_search, 10.0, 1.0, 5.0, 2.0) as bm25_rank,
                 a.id, a.title, a.author, a.snippet, a.url, a.image_url, a.published_at,
                 s.id as source_id, s.title as source_title, s.category,
                 50 as authority_score, p.domain as publisher_domain
          FROM article_search fs
          JOIN articles a ON a.id = fs.article_id
          JOIN sources s ON a.source_id = s.id
          LEFT JOIN publishers p ON s.publisher_domain = p.domain
          WHERE article_search MATCH ?
          ${filterSql}
          LIMIT ?
        `;
        const candidateResults = await env.DB.prepare(candidateQuery).bind(...params).all();
        rawCandidates = candidateResults.results || [];
      } catch (ftsErr) {
        rawCandidates = [];
      }

      // If FTS missed (common for long multi-word discover queries), fall back to token LIKE
      if (!rawCandidates.length) {
        const tokens = rawQuery
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 2)
          .slice(0, 6);
        if (tokens.length) {
          const likeClauses = tokens.map(() => '(LOWER(a.title) LIKE ? OR LOWER(IFNULL(a.snippet,\'\')) LIKE ? OR LOWER(s.title) LIKE ?)').join(' OR ');
          const likeParams = [];
          tokens.forEach((t) => {
            const p = '%' + t + '%';
            likeParams.push(p, p, p);
          });
          likeParams.push(limit);
          try {
            const likeRows = await env.DB.prepare(`
              SELECT a.id, a.title, a.author, a.snippet, a.url, a.image_url, a.published_at,
                     s.id as source_id, s.title as source_title, s.category,
                     50 as authority_score, s.publisher_domain as publisher_domain,
                     0 as bm25_rank
              FROM articles a
              JOIN sources s ON a.source_id = s.id
              WHERE ${likeClauses}
              ORDER BY a.published_at DESC
              LIMIT ?
            `).bind(...likeParams).all();
            rawCandidates = likeRows.results || [];
          } catch (likeErr) {
            rawCandidates = [];
          }
        }
      }

      // Calculate precision composite scores in memory
      const scoredItems = rawCandidates.map(row => {
        const score = calculateRankingScore({
          bm25Rank: row.bm25_rank,
          publishedAt: row.published_at,
          authorityScore: row.authority_score,
          engagementScore: 0
        });

        return {
          id: row.id,
          title: row.title,
          author: row.author,
          snippet: row.snippet,
          url: row.url,
          image_url: row.image_url,
          published_at: row.published_at,
          source: {
            id: row.source_id,
            title: row.source_title,
            category: row.category,
            domain: row.publisher_domain,
            authority: row.authority_score
          },
          ranking_score: score,
          bm25_rank: row.bm25_rank,
          why_badges: generateWhyBadges(row, rawQuery)
        };
      });

      // Apply sort order
      if (sortOrder === 'latest') {
        scoredItems.sort((a, b) => b.published_at - a.published_at);
      } else if (sortOrder === 'authority') {
        scoredItems.sort((a, b) => b.source.authority - a.source.authority);
      } else {
        // Default: 50% BM25 Hybrid Relevance
        scoredItems.sort((a, b) => b.ranking_score - a.ranking_score);
      }

      stories = scoredItems.slice(0, limit);
      // Honest page size — do not report the internal candidate pool cap as "total"
      totalCount = stories.length;
    }

    const executionMs = Date.now() - startTime;

    // Asynchronously log search telemetry
    if (rawQuery && env.DB) {
      const queryId = `sq_${generateRandomHex(12)}`;
      const normalizedQuery = rawQuery.toLowerCase();
      
      const logPromise = env.DB.prepare(`
        INSERT INTO search_queries (id, user_id, query, normalized_query, result_count, execution_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(queryId, userId, rawQuery, normalizedQuery, totalCount, executionMs, startTime).run().catch(() => {});

      if (ctx && ctx.waitUntil) {
        ctx.waitUntil(logPromise);
      }
    }

    return jsonResponse({
      status: 'success',
      query: rawQuery,
      total: totalCount,
      execution_ms: executionMs,
      items: stories
    });

  } catch (err) {
    console.error('Search execution error:', err.message);
    return errorResponse('Search failed: ' + err.message, 500);
  }
}

/**
 * GET /api/search/suggest — Sub-20ms Prefix Autocomplete
 */
export async function handleSuggestions(request, url, env) {
  if (!env.DB) return jsonResponse({ status: 'success', suggestions: [] });

  const query = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!query || query.length < 2) {
    // Return top 6 trending terms
    try {
      const top = await env.DB.prepare(`
        SELECT term, search_count, click_count 
        FROM search_suggestions 
        ORDER BY search_count DESC 
        LIMIT 6
      `).all();
      return jsonResponse({ status: 'success', suggestions: top.results || [] });
    } catch (e) {
      return jsonResponse({ status: 'success', suggestions: [] });
    }
  }

  try {
    const rows = await env.DB.prepare(`
      SELECT term, search_count, click_count 
      FROM search_suggestions 
      WHERE term LIKE ? 
      ORDER BY (search_count * 2 + click_count * 3) DESC 
      LIMIT 6
    `).bind(`${query}%`).all();

    return jsonResponse({
      status: 'success',
      suggestions: rows.results || []
    });
  } catch (err) {
    console.error('Suggestions error:', err.message);
    return jsonResponse({ status: 'success', suggestions: [] });
  }
}

/**
 * GET, POST, DELETE /api/search/saved — Saved Search Workspaces
 */
export async function handleSavedSearches(request, url, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  const method = request.method;

  // GET: List user's saved searches
  if (method === 'GET') {
    try {
      const rows = await env.DB.prepare(`
        SELECT id, name, search_query, filters_json, created_at, last_used_at 
        FROM saved_searches 
        WHERE user_id = ? 
        ORDER BY created_at DESC
      `).bind(session.userId).all();

      return jsonResponse({ status: 'success', saved_searches: rows.results || [] });
    } catch (err) {
      return errorResponse('Failed to list saved searches', 500);
    }
  }

  // POST: Create a new saved search
  if (method === 'POST') {
    try {
      const body = await request.json();
      const searchQuery = (body.search_query || body.query || '').trim();
      const name = (body.name || searchQuery || 'Saved Search').trim();
      const filtersJson = typeof body.filters === 'object' ? JSON.stringify(body.filters) : (body.filters_json || '{}');

      if (!searchQuery) return errorResponse('Search query is required', 400);

      const id = `ss_${generateRandomHex(12)}`;
      const now = Date.now();

      await env.DB.prepare(`
        INSERT INTO saved_searches (id, user_id, name, search_query, filters_json, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, session.userId, name, searchQuery, filtersJson, now, now).run();

      return jsonResponse({ status: 'success', message: 'Search saved', id, name, search_query: searchQuery }, 201);
    } catch (err) {
      return errorResponse('Failed to save search: ' + err.message, 500);
    }
  }

  // DELETE: Remove a saved search
  if (method === 'DELETE') {
    const id = url.searchParams.get('id') || url.pathname.split('/').pop();
    if (!id) return errorResponse('Saved search ID required', 400);

    try {
      await env.DB.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').bind(id, session.userId).run();
      return jsonResponse({ status: 'success', message: 'Saved search removed' });
    } catch (err) {
      return errorResponse('Failed to delete saved search', 500);
    }
  }

  return errorResponse('Method Not Allowed', 405);
}

/**
 * GET, POST, DELETE /api/search/alerts — Keyword Watchlist Alerts
 */
export async function handleKeywordAlerts(request, url, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  const method = request.method;

  // GET: List active keyword alerts
  if (method === 'GET') {
    try {
      const rows = await env.DB.prepare(`
        SELECT id, keyword, is_active, notification_channel, last_notified_at, match_count, created_at 
        FROM keyword_alerts 
        WHERE user_id = ? 
        ORDER BY created_at DESC
      `).bind(session.userId).all();

      return jsonResponse({ status: 'success', alerts: rows.results || [] });
    } catch (err) {
      return errorResponse('Failed to list alerts', 500);
    }
  }

  // POST: Create a new keyword alert
  if (method === 'POST') {
    try {
      const body = await request.json();
      const keyword = (body.keyword || '').trim();
      const channel = (body.notification_channel || 'in_app').trim();

      if (!keyword) return errorResponse('Keyword is required', 400);

      const id = `ka_${generateRandomHex(12)}`;
      const now = Date.now();

      await env.DB.prepare(`
        INSERT INTO keyword_alerts (id, user_id, keyword, is_active, notification_channel, last_notified_at, match_count, created_at)
        VALUES (?, ?, ?, 1, ?, NULL, 0, ?)
      `).bind(id, session.userId, keyword, channel, now).run();

      return jsonResponse({ status: 'success', message: 'Alert created', id, keyword }, 201);
    } catch (err) {
      return errorResponse('Failed to create alert: ' + err.message, 500);
    }
  }

  // DELETE: Remove a keyword alert
  if (method === 'DELETE') {
    const id = url.searchParams.get('id') || url.pathname.split('/').pop();
    if (!id) return errorResponse('Alert ID required', 400);

    try {
      await env.DB.prepare('DELETE FROM keyword_alerts WHERE id = ? AND user_id = ?').bind(id, session.userId).run();
      return jsonResponse({ status: 'success', message: 'Alert removed' });
    } catch (err) {
      return errorResponse('Failed to delete alert', 500);
    }
  }

  return errorResponse('Method Not Allowed', 405);
}

/**
 * POST /api/search/click — Log Search Clicks for CTR & Suggestion Weighting
 */
export async function handleRecordClick(request, env) {
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const articleId = body.article_id;
    const rankPosition = parseInt(body.rank_position || '1', 10);
    const queryId = body.query_id || null;
    const term = (body.term || '').trim();

    if (!articleId) return errorResponse('Article ID required', 400);

    const session = await verifySessionToken(request, env).catch(() => null);
    const userId = session ? session.userId : null;
    const clickId = `clk_${generateRandomHex(12)}`;
    const now = Date.now();

    await env.DB.prepare(`
      INSERT INTO search_clicks (id, query_id, user_id, article_id, rank_position, clicked_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(clickId, queryId, userId, articleId, rankPosition, now).run();

    // Increment suggestion click count if term was provided
    if (term) {
      await env.DB.prepare(`
        UPDATE search_suggestions SET click_count = click_count + 1 WHERE term = ?
      `).bind(term).run().catch(() => {});
    }

    return jsonResponse({ status: 'success', message: 'Click recorded' });
  } catch (err) {
    return errorResponse('Failed to record click: ' + err.message, 500);
  }
}
