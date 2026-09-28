/**
 * FeedOmeter 2.1 — SearchService
 * Domain Service for Search, Keyword Autocomplete, Saved Searches, Queries & Click Analytics
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class SearchService {
  /**
   * Search articles with keyword suggestions and query logging
   */
  async search({ userId = null, queryText, category = null, limit = 30, offset = 0, sessionId = null, ipAddress = null }) {
    if (!queryText || !queryText.trim()) {
      return { results: [], total: 0, query: '' };
    }

    const cleanQuery = queryText.trim();
    const queryPattern = `%${cleanQuery}%`;
    const now = Date.now();
    const searchParams = {
      queryPattern: { type: sql.NVarChar(255), value: queryPattern },
      limit: { type: sql.Int, value: Math.min(Number(limit) || 30, 100) },
      offset: { type: sql.Int, value: Number(offset) || 0 }
    };

    let catFilter = '';
    if (category && category !== 'all') {
      catFilter = ' AND s.category = @category';
      searchParams.category = { type: sql.NVarChar(64), value: category };
    }

    const countRes = await query(`
      SELECT COUNT(*) AS total
      FROM dbo.articles a
      INNER JOIN dbo.sources s ON a.source_id = s.id
      WHERE (a.title LIKE @queryPattern OR a.snippet LIKE @queryPattern OR a.author LIKE @queryPattern OR s.title LIKE @queryPattern)
      ${catFilter}
    `, searchParams);

    const total = countRes.recordset ? countRes.recordset[0].total : 0;

    const results = await query(`
      SELECT 
        a.id, a.title, a.url, a.snippet, a.author, a.published_at, a.image_url,
        s.id AS source_id, s.title AS source_name, s.title AS source_title, s.category AS source_category, s.logo_url AS source_logo_url
      FROM dbo.articles a
      INNER JOIN dbo.sources s ON a.source_id = s.id
      WHERE (a.title LIKE @queryPattern OR a.snippet LIKE @queryPattern OR a.author LIKE @queryPattern OR s.title LIKE @queryPattern)
      ${catFilter}
      ORDER BY a.published_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, searchParams);

    // Log query in search_queries asynchronously
    const queryId = 'sq_' + crypto.randomBytes(12).toString('hex');
    query(`
      INSERT INTO dbo.search_queries (id, user_id, query, created_at)
      VALUES (@id, @userId, @queryText, @now)
    `, {
      id: { type: sql.NVarChar(64), value: queryId },
      userId: { type: sql.NVarChar(64), value: userId },
      queryText: { type: sql.NVarChar(500), value: cleanQuery },
      now: { type: sql.BigInt, value: now }
    }).catch(() => {});

    // Update search suggestions popularity
    query(`
      IF EXISTS (SELECT 1 FROM dbo.search_suggestions WHERE term = @cleanQuery)
      BEGIN
        UPDATE dbo.search_suggestions SET search_count = search_count + 1, updated_at = @now WHERE term = @cleanQuery
      END
      ELSE
      BEGIN
        INSERT INTO dbo.search_suggestions (term, search_count, click_count, updated_at)
        VALUES (@cleanQuery, 1, 0, @now)
      END
    `, {
      cleanQuery: { type: sql.NVarChar(255), value: cleanQuery.toLowerCase() },
      now: { type: sql.BigInt, value: now }
    }).catch(() => {});

    return {
      query: cleanQuery,
      query_id: queryId,
      total,
      results: results.recordset || []
    };
  }

  /**
   * Get search suggestions / autocomplete
   */
  async getSuggestions(prefix, limit = 8) {
    if (!prefix || !prefix.trim()) {
      const trending = await query(`
        SELECT TOP 8 term AS suggestion, search_count AS frequency
        FROM dbo.search_suggestions
        ORDER BY search_count DESC
      `);
      return trending.recordset || [];
    }

    const result = await query(`
      SELECT TOP (@limit) term AS suggestion, search_count AS frequency
      FROM dbo.search_suggestions
      WHERE term LIKE @pattern
      ORDER BY search_count DESC
    `, {
      pattern: { type: sql.NVarChar(255), value: `${prefix.trim().toLowerCase()}%` },
      limit: { type: sql.Int, value: Number(limit) || 8 }
    });

    return result.recordset || [];
  }

  /**
   * Save a user search
   */
  async saveSearch(userId, { name, queryText, filters = {} }) {
    const searchId = 'ss_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    await query(`
      INSERT INTO dbo.saved_searches (id, user_id, name, search_query, filters_json, created_at, last_used_at)
      VALUES (@id, @userId, @name, @query, @filters, @now, @now)
    `, {
      id: { type: sql.NVarChar(64), value: searchId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(255), value: name || queryText },
      query: { type: sql.NVarChar(500), value: queryText },
      filters: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(filters) },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, id: searchId };
  }

  /**
   * List saved searches for user
   */
  async getSavedSearches(userId) {
    const result = await query(`
      SELECT id, name, search_query AS query, filters_json, last_used_at, created_at
      FROM dbo.saved_searches
      WHERE user_id = @userId
      ORDER BY created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return result.recordset || [];
  }

  /**
   * Log search click for ranking optimization
   */
  async logSearchClick(queryId, articleId, position, userId = null) {
    const clickId = 'sclk_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    await query(`
      INSERT INTO dbo.search_clicks (id, user_id, article_id, created_at)
      VALUES (@id, @userId, @articleId, @now)
    `, {
      id: { type: sql.NVarChar(64), value: clickId },
      userId: { type: sql.NVarChar(64), value: userId },
      articleId: { type: sql.NVarChar(64), value: articleId },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true };
  }
}

module.exports = new SearchService();
