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
      WHERE (a.title LIKE @queryPattern OR a.summary LIKE @queryPattern OR a.author LIKE @queryPattern OR s.name LIKE @queryPattern)
      ${catFilter}
    `, searchParams);

    const total = countRes.recordset ? countRes.recordset[0].total : 0;

    const results = await query(`
      SELECT 
        a.id, a.title, a.url, a.summary, a.author, a.published_at, a.image_url, a.reading_time_mins,
        s.id AS source_id, s.name AS source_name, s.category AS source_category, s.icon_url AS source_icon_url
      FROM dbo.articles a
      INNER JOIN dbo.sources s ON a.source_id = s.id
      WHERE (a.title LIKE @queryPattern OR a.summary LIKE @queryPattern OR a.author LIKE @queryPattern OR s.name LIKE @queryPattern)
      ${catFilter}
      ORDER BY a.published_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, searchParams);

    // Log query in search_queries asynchronously
    const queryId = 'sq_' + crypto.randomBytes(12).toString('hex');
    query(`
      INSERT INTO dbo.search_queries (id, user_id, session_id, query_text, results_count, ip_address, created_at)
      VALUES (@id, @userId, @sessionId, @queryText, @resCount, @ip, SYSUTCDATETIME())
    `, {
      id: { type: sql.NVarChar(64), value: queryId },
      userId: { type: sql.NVarChar(64), value: userId },
      sessionId: { type: sql.VarChar(64), value: sessionId },
      queryText: { type: sql.NVarChar(255), value: cleanQuery },
      resCount: { type: sql.Int, value: total },
      ip: { type: sql.VarChar(45), value: ipAddress }
    }).catch(() => {});

    // Update search suggestions popularity
    query(`
      IF EXISTS (SELECT 1 FROM dbo.search_suggestions WHERE suggestion = @cleanQuery)
      BEGIN
        UPDATE dbo.search_suggestions SET frequency = frequency + 1, updated_at = SYSUTCDATETIME() WHERE suggestion = @cleanQuery
      END
      ELSE
      BEGIN
        INSERT INTO dbo.search_suggestions (suggestion, category, frequency, is_trending, created_at, updated_at)
        VALUES (@cleanQuery, 'search', 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME())
      END
    `, { cleanQuery: { type: sql.NVarChar(128), value: cleanQuery.toLowerCase() } }).catch(() => {});

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
        SELECT TOP 8 suggestion, frequency, is_trending
        FROM dbo.search_suggestions
        ORDER BY is_trending DESC, frequency DESC
      `);
      return trending.recordset || [];
    }

    const result = await query(`
      SELECT TOP (@limit) suggestion, frequency, is_trending
      FROM dbo.search_suggestions
      WHERE suggestion LIKE @pattern
      ORDER BY frequency DESC
    `, {
      pattern: { type: sql.NVarChar(128), value: `${prefix.trim().toLowerCase()}%` },
      limit: { type: sql.Int, value: Number(limit) || 8 }
    });

    return result.recordset || [];
  }

  /**
   * Save a user search
   */
  async saveSearch(userId, { name, queryText, filters = {} }) {
    const searchId = 'ss_' + crypto.randomBytes(12).toString('hex');
    await query(`
      INSERT INTO dbo.saved_searches (id, user_id, name, query, filters_json, created_at, updated_at)
      VALUES (@id, @userId, @name, @query, @filters, SYSUTCDATETIME(), SYSUTCDATETIME())
    `, {
      id: { type: sql.NVarChar(64), value: searchId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(128), value: name || queryText },
      query: { type: sql.NVarChar(255), value: queryText },
      filters: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(filters) }
    });

    return { success: true, id: searchId };
  }

  /**
   * List saved searches for user
   */
  async getSavedSearches(userId) {
    const result = await query(`
      SELECT id, name, query, filters_json, last_run_at, created_at
      FROM dbo.saved_searches
      WHERE user_id = @userId
      ORDER BY created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return result.recordset || [];
  }

  /**
   * Log search click for ranking optimization
   */
  async logSearchClick(queryId, articleId, position) {
    const clickId = 'sclk_' + crypto.randomBytes(12).toString('hex');
    await query(`
      INSERT INTO dbo.search_clicks (id, query_id, article_id, position, created_at)
      VALUES (@id, @queryId, @articleId, @position, SYSUTCDATETIME())
    `, {
      id: { type: sql.NVarChar(64), value: clickId },
      queryId: { type: sql.NVarChar(64), value: queryId },
      articleId: { type: sql.NVarChar(64), value: articleId },
      position: { type: sql.Int, value: Number(position) || 0 }
    });

    return { success: true };
  }
}

module.exports = new SearchService();
