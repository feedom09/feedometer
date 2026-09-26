/**
 * FeedOmeter 2.1 — ArticleService
 * Domain Service for Articles, Reading History, Starred/Saved, and Ingestion Event Tracking
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class ArticleService {
  /**
   * Fetch articles with flexible filters (feed, folder, starred, saved, unread, search)
   */
  async getArticles({
    userId = null,
    sourceId = null,
    folderId = null,
    isStarred = null,
    isSaved = null,
    isUnreadOnly = false,
    tagId = null,
    search = null,
    limit = 30,
    offset = 0
  } = {}) {
    let whereConditions = [];
    const params = {
      limit: { type: sql.Int, value: Math.min(Number(limit) || 30, 100) },
      offset: { type: sql.Int, value: Number(offset) || 0 }
    };

    if (userId) {
      params.userId = { type: sql.NVarChar(64), value: userId };
    }

    if (sourceId) {
      whereConditions.push(`a.source_id = @sourceId`);
      params.sourceId = { type: sql.NVarChar(64), value: sourceId };
    }

    if (folderId && userId) {
      whereConditions.push(`a.source_id IN (
        SELECT uf.source_id 
        FROM dbo.user_feeds uf
        INNER JOIN dbo.user_feed_assignments ufa ON uf.id = ufa.user_feed_id
        WHERE uf.user_id = @userId AND ufa.folder_id = @folderId
      )`);
      params.folderId = { type: sql.NVarChar(64), value: folderId };
    }

    if (isStarred && userId) {
      whereConditions.push(`EXISTS (SELECT 1 FROM dbo.starred_articles sa WHERE sa.user_id = @userId AND sa.article_id = a.id)`);
    }

    if (isSaved && userId) {
      whereConditions.push(`EXISTS (SELECT 1 FROM dbo.saved_articles sva WHERE sva.user_id = @userId AND sva.article_id = a.id)`);
    }

    if (isUnreadOnly && userId) {
      whereConditions.push(`NOT EXISTS (SELECT 1 FROM dbo.read_history rh WHERE rh.user_id = @userId AND rh.article_id = a.id)`);
    }

    if (tagId && userId) {
      whereConditions.push(`EXISTS (SELECT 1 FROM dbo.article_tag_assignments ata WHERE ata.tag_id = @tagId AND ata.article_id = a.id AND ata.user_id = @userId)`);
      params.tagId = { type: sql.NVarChar(64), value: tagId };
    }

    if (search && search.trim()) {
      whereConditions.push(`(a.title LIKE @search OR a.snippet LIKE @search OR a.author LIKE @search)`);
      params.search = { type: sql.NVarChar(255), value: `%${search.trim()}%` };
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const userSelectSql = userId
      ? `
        CASE WHEN sa.article_id IS NOT NULL THEN 1 ELSE 0 END AS is_starred,
        CASE WHEN sva.article_id IS NOT NULL THEN 1 ELSE 0 END AS is_saved,
        CASE WHEN rh.article_id IS NOT NULL THEN 1 ELSE 0 END AS is_read
      `
      : `0 AS is_starred, 0 AS is_saved, 0 AS is_read`;

    const userJoinSql = userId
      ? `
        LEFT JOIN dbo.starred_articles sa ON a.id = sa.article_id AND sa.user_id = @userId
        LEFT JOIN dbo.saved_articles sva ON a.id = sva.article_id AND sva.user_id = @userId
        LEFT JOIN dbo.read_history rh ON a.id = rh.article_id AND rh.user_id = @userId
      `
      : '';

    const result = await query(`
      SELECT 
        a.id, a.source_id, a.title, a.url, a.author, a.snippet, a.content, a.image_url, 
        a.published_at, a.ingested_at, a.is_pinned,
        s.title AS source_name, s.website_url AS source_site_url, s.logo_url AS source_icon_url, s.category AS source_category,
        ${userSelectSql}
      FROM dbo.articles a
      INNER JOIN dbo.sources s ON a.source_id = s.id
      ${userJoinSql}
      ${whereSql}
      ORDER BY a.published_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    return result.recordset || [];
  }

  /**
   * Star / Unstar an article
   */
  async toggleStar(userId, articleId) {
    const existing = await query(`
      SELECT 1 FROM dbo.starred_articles WHERE user_id = @userId AND article_id = @articleId
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      articleId: { type: sql.NVarChar(64), value: articleId }
    });

    if (existing.recordset && existing.recordset.length > 0) {
      await query(`DELETE FROM dbo.starred_articles WHERE user_id = @userId AND article_id = @articleId`, {
        userId: { type: sql.NVarChar(64), value: userId },
        articleId: { type: sql.NVarChar(64), value: articleId }
      });
      return { starred: false };
    } else {
      await query(`
        INSERT INTO dbo.starred_articles (user_id, article_id, starred_at)
        VALUES (@userId, @articleId, @now)
      `, {
        userId: { type: sql.NVarChar(64), value: userId },
        articleId: { type: sql.NVarChar(64), value: articleId },
        now: { type: sql.BigInt, value: Date.now() }
      });
      return { starred: true };
    }
  }

  /**
   * Save / Unsave (Read Later) an article
   */
  async toggleSave(userId, articleId) {
    const existing = await query(`
      SELECT 1 FROM dbo.saved_articles WHERE user_id = @userId AND article_id = @articleId
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      articleId: { type: sql.NVarChar(64), value: articleId }
    });

    if (existing.recordset && existing.recordset.length > 0) {
      await query(`DELETE FROM dbo.saved_articles WHERE user_id = @userId AND article_id = @articleId`, {
        userId: { type: sql.NVarChar(64), value: userId },
        articleId: { type: sql.NVarChar(64), value: articleId }
      });
      return { saved: false };
    } else {
      await query(`
        INSERT INTO dbo.saved_articles (user_id, article_id, saved_at)
        VALUES (@userId, @articleId, @now)
      `, {
        userId: { type: sql.NVarChar(64), value: userId },
        articleId: { type: sql.NVarChar(64), value: articleId },
        now: { type: sql.BigInt, value: Date.now() }
      });
      return { saved: true };
    }
  }

  /**
   * Mark article as read / unread
   */
  async markRead(userId, articleId, isRead = true) {
    if (isRead) {
      await query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.read_history WHERE user_id = @userId AND article_id = @articleId)
        BEGIN
          INSERT INTO dbo.read_history (user_id, article_id, read_at)
          VALUES (@userId, @articleId, @now)
        END
      `, {
        userId: { type: sql.NVarChar(64), value: userId },
        articleId: { type: sql.NVarChar(64), value: articleId },
        now: { type: sql.BigInt, value: Date.now() }
      });
    } else {
      await query(`DELETE FROM dbo.read_history WHERE user_id = @userId AND article_id = @articleId`, {
        userId: { type: sql.NVarChar(64), value: userId },
        articleId: { type: sql.NVarChar(64), value: articleId }
      });
    }

    return { success: true, is_read: isRead };
  }

  /**
   * Mark all articles read for a source or globally for user
   */
  async markAllRead(userId, { sourceId = null, folderId = null } = {}) {
    let targetArticleQuery = `SELECT a.id FROM dbo.articles a`;
    const params = {
      userId: { type: sql.NVarChar(64), value: userId },
      now: { type: sql.BigInt, value: Date.now() }
    };

    if (sourceId) {
      targetArticleQuery += ` WHERE a.source_id = @sourceId`;
      params.sourceId = { type: sql.NVarChar(64), value: sourceId };
    } else if (folderId) {
      targetArticleQuery += ` 
        INNER JOIN dbo.user_feeds uf ON a.source_id = uf.source_id
        INNER JOIN dbo.user_feed_assignments ufa ON uf.id = ufa.user_feed_id
        WHERE uf.user_id = @userId AND ufa.folder_id = @folderId`;
      params.folderId = { type: sql.NVarChar(64), value: folderId };
    }

    await query(`
      INSERT INTO dbo.read_history (user_id, article_id, read_at)
      SELECT @userId, t.id, @now
      FROM (${targetArticleQuery}) t
      WHERE NOT EXISTS (SELECT 1 FROM dbo.read_history rh WHERE rh.user_id = @userId AND rh.article_id = t.id)
    `, params);

    return { success: true, message: 'All items marked as read.' };
  }

  /**
   * Log reader interaction event
   */
  async trackArticleEvent(userId, articleId, eventType, sourceId = null, metadataJson = null) {
    const eventId = 'aev_' + crypto.randomBytes(12).toString('hex');
    await query(`
      INSERT INTO dbo.article_events (id, article_id, user_id, source_id, event_type, metadata_json, created_at)
      VALUES (@id, @articleId, @userId, @sourceId, @eventType, @meta, @now)
    `, {
      id: { type: sql.NVarChar(64), value: eventId },
      articleId: { type: sql.NVarChar(64), value: articleId },
      userId: { type: sql.NVarChar(64), value: userId },
      sourceId: { type: sql.NVarChar(64), value: sourceId },
      eventType: { type: sql.NVarChar(50), value: eventType },
      meta: { type: sql.NVarChar(sql.MAX), value: metadataJson ? JSON.stringify(metadataJson) : null },
      now: { type: sql.BigInt, value: Date.now() }
    });
  }
}

module.exports = new ArticleService();
