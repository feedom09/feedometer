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
    followedOnly = false,
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
        INNER JOIN dbo.user_feed_assignments ufa ON ufa.feed_id = uf.source_id AND ufa.user_id = uf.user_id
        WHERE uf.user_id = @userId AND ufa.folder_id = @folderId
      )`);
      params.folderId = { type: sql.NVarChar(64), value: folderId };
    }

    // A personal stream may contain articles only from sources the signed-in
    // user follows. Folder filtering above further narrows this same scope.
    if (followedOnly && userId) {
      whereConditions.push(`a.source_id IN (
        SELECT source_id FROM dbo.user_feeds WHERE user_id = @userId
      )`);
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
   * Resolve a stream item to the persistent SQL Server article catalog.
   * Live RSS IDs are deliberately display-only, so bookmarks are always tied
   * to a canonical URL rather than a transient `live_*` ID.
   */
  async findCatalogArticleId(articleData = {}) {
    const rawUrl = String(articleData.url || articleData.link || '').trim();
    if (rawUrl) {
      const canonicalUrl = this.canonicalizeUrl(rawUrl);
      const canonicalHash = this.canonicalUrlHash(canonicalUrl);
      const existing = await query(`SELECT id FROM dbo.articles WHERE canonical_url_hash = @canonicalHash`, {
        canonicalHash: { type: sql.VarChar(64), value: canonicalHash }
      });
      if (existing.recordset && existing.recordset[0]) return existing.recordset[0].id;
    }

    const requestedId = String(articleData.article_id || articleData.articleId || '').trim();
    if (requestedId && !requestedId.startsWith('live_')) {
      const existing = await query(`SELECT id FROM dbo.articles WHERE id = @articleId`, {
        articleId: { type: sql.NVarChar(64), value: requestedId }
      });
      if (existing.recordset && existing.recordset[0]) return existing.recordset[0].id;
    }
    return null;
  }

  canonicalizeUrl(rawUrl) {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString();
  }

  canonicalUrlHash(canonicalUrl) {
    return crypto.createHash('sha256').update(canonicalUrl).digest('hex');
  }

  async ensureCatalogArticle(articleData = {}) {
    const rawUrl = String(articleData.url || articleData.link || '').trim();
    if (!rawUrl) throw new Error('A valid article URL is required.');

    let canonicalUrl;
    try {
      canonicalUrl = this.canonicalizeUrl(rawUrl);
    } catch (_) {
      throw new Error('A valid article URL is required.');
    }

    const canonicalHash = this.canonicalUrlHash(canonicalUrl);
    const existingId = await this.findCatalogArticleId({ url: canonicalUrl });
    if (existingId) return existingId;

    const sourceId = String(articleData.source_id || articleData.sourceId || '').trim();
    if (!sourceId) throw new Error('The article source is required to save this item.');
    const source = await query(`SELECT id FROM dbo.sources WHERE id = @sourceId`, {
      sourceId: { type: sql.NVarChar(64), value: sourceId }
    });
    if (!source.recordset || !source.recordset[0]) {
      throw new Error('The article source is no longer available. Refresh Trending and try again.');
    }

    const now = Date.now();
    const rawPublished = articleData.published || articleData.pubDate || articleData.published_at;
    const parsedPublished = rawPublished ? new Date(rawPublished).getTime() : NaN;
    const publishedAt = Number.isFinite(parsedPublished) ? parsedPublished : now;
    const articleId = `art_${canonicalHash.slice(0, 32)}`;

    try {
      await query(`
        INSERT INTO dbo.articles
          (id, canonical_url_hash, source_id, title, url, author, snippet, content, image_url, published_at, ingested_at)
        VALUES
          (@id, @canonicalHash, @sourceId, @title, @url, @author, @snippet, @content, @imageUrl, @publishedAt, @ingestedAt)
      `, {
        id: { type: sql.NVarChar(64), value: articleId },
        canonicalHash: { type: sql.VarChar(64), value: canonicalHash },
        sourceId: { type: sql.NVarChar(64), value: sourceId },
        title: { type: sql.NVarChar(500), value: String(articleData.title || 'Untitled Article').slice(0, 500) },
        url: { type: sql.NVarChar(1000), value: canonicalUrl.slice(0, 1000) },
        author: { type: sql.NVarChar(255), value: String(articleData.author || articleData.creator || '').slice(0, 255) || null },
        snippet: { type: sql.NVarChar(1500), value: String(articleData.snippet || articleData.summary || articleData.description || '').slice(0, 1500) || null },
        content: { type: sql.NVarChar(sql.MAX), value: String(articleData.content || '').slice(0, 20000) || null },
        imageUrl: { type: sql.NVarChar(1000), value: String(articleData.image_url || articleData.image || '').slice(0, 1000) || null },
        publishedAt: { type: sql.BigInt, value: publishedAt },
        ingestedAt: { type: sql.BigInt, value: now }
      });
      return articleId;
    } catch (err) {
      // A concurrent click/request may have inserted the canonical article.
      const resolvedId = await this.findCatalogArticleId({ url: canonicalUrl });
      if (resolvedId) return resolvedId;
      throw err;
    }
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
        INSERT INTO dbo.starred_articles (id, user_id, article_id, starred_at)
        VALUES (@id, @userId, @articleId, @now)
      `, {
        id: { type: sql.NVarChar(64), value: `sta_${crypto.randomBytes(12).toString('hex')}` },
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
        INSERT INTO dbo.saved_articles (id, user_id, article_id, saved_at)
        VALUES (@id, @userId, @articleId, @now)
      `, {
        id: { type: sql.NVarChar(64), value: `sav_${crypto.randomBytes(12).toString('hex')}` },
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
        INNER JOIN dbo.user_feed_assignments ufa ON ufa.feed_id = uf.source_id AND ufa.user_id = uf.user_id
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
