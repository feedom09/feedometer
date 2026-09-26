/**
 * FeedOmeter 2.1 — FeedService
 * Domain Service for RSS/Atom Source Directory, Subscriptions & Ingestion Lifecycle
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class FeedService {
  /**
   * List global discovered/verified sources with filtering and search
   */
  async listSources({ category, search, limit = 50, offset = 0 } = {}) {
    let whereClause = `WHERE s.status = 'active'`;
    const params = {
      limit: { type: sql.Int, value: Math.min(Number(limit) || 50, 200) },
      offset: { type: sql.Int, value: Number(offset) || 0 }
    };

    if (category && category !== 'all') {
      whereClause += ` AND s.category = @category`;
      params.category = { type: sql.NVarChar(100), value: category };
    }

    if (search && search.trim()) {
      whereClause += ` AND (s.title LIKE @search OR s.publisher_domain LIKE @search OR s.category LIKE @search)`;
      params.search = { type: sql.NVarChar(255), value: `%${search.trim()}%` };
    }

    const result = await query(`
      SELECT 
        s.id, s.title, s.feed_url, s.website_url, s.source_type, s.category, 
        s.language, s.logo_url, s.is_verified, s.article_count, s.last_polled_at, 
        s.last_article_at, s.status, s.publisher_domain,
        p.name AS publisher_name, p.logo_url AS publisher_logo, p.is_popular AS publisher_is_popular,
        (SELECT COUNT(*) FROM dbo.user_feeds uf WHERE uf.source_id = s.id) AS subscriber_count
      FROM dbo.sources s
      LEFT JOIN dbo.publishers p ON s.publisher_domain = p.domain
      ${whereClause}
      ORDER BY s.article_count DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    return result.recordset || [];
  }

  /**
   * Get all subscribed feeds for a specific user
   */
  async getUserFeeds(userId) {
    const result = await query(`
      SELECT 
        uf.id AS user_feed_id,
        uf.followed_at,
        ufa.folder_id,
        f.name AS folder_name,
        f.icon AS folder_icon,
        s.id AS source_id,
        s.title AS source_name,
        s.feed_url,
        s.website_url,
        s.category,
        s.logo_url,
        s.last_polled_at,
        s.status AS source_status,
        s.article_count
      FROM dbo.user_feeds uf
      INNER JOIN dbo.sources s ON uf.source_id = s.id
      LEFT JOIN dbo.user_feed_assignments ufa ON uf.id = ufa.user_feed_id
      LEFT JOIN dbo.folders f ON ufa.folder_id = f.id
      WHERE uf.user_id = @userId
      ORDER BY s.title ASC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return result.recordset || [];
  }

  /**
   * Subscribe user to a feed source (or create source if URL is given)
   */
  async subscribeFeed(userId, { sourceId, feedUrl, title, siteUrl, category = 'general', folderId = null }) {
    let targetSourceId = sourceId;
    const now = Date.now();

    // If sourceId is not given, find or create source by feedUrl
    if (!targetSourceId && feedUrl) {
      const cleanFeedUrl = feedUrl.trim();
      const existing = await query(`SELECT id FROM dbo.sources WHERE feed_url = @feedUrl`, {
        feedUrl: { type: sql.NVarChar(1000), value: cleanFeedUrl }
      });

      if (existing.recordset && existing.recordset.length > 0) {
        targetSourceId = existing.recordset[0].id;
      } else {
        // Create new source
        targetSourceId = 'src_' + crypto.randomBytes(12).toString('hex');
        const domainMatch = cleanFeedUrl.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/i);
        const domain = domainMatch ? domainMatch[1] : null;

        await query(`
          INSERT INTO dbo.sources (id, publisher_domain, title, feed_url, website_url, source_type, category, language, is_verified, article_count, status)
          VALUES (@id, @domain, @title, @feedUrl, @siteUrl, 'rss', @category, 'en', 0, 0, 'active')
        `, {
          id: { type: sql.NVarChar(64), value: targetSourceId },
          domain: { type: sql.NVarChar(255), value: domain },
          title: { type: sql.NVarChar(255), value: title || domain || 'Custom Feed' },
          feedUrl: { type: sql.NVarChar(1000), value: cleanFeedUrl },
          siteUrl: { type: sql.NVarChar(1000), value: siteUrl || cleanFeedUrl },
          category: { type: sql.NVarChar(100), value: category }
        });
      }
    }

    if (!targetSourceId) {
      throw new Error('sourceId or feedUrl is required.');
    }

    // Check if already subscribed
    const check = await query(`
      SELECT id FROM dbo.user_feeds WHERE user_id = @userId AND source_id = @sourceId
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      sourceId: { type: sql.NVarChar(64), value: targetSourceId }
    });

    let userFeedId;

    if (check.recordset && check.recordset.length > 0) {
      userFeedId = check.recordset[0].id;
    } else {
      userFeedId = 'uf_' + crypto.randomBytes(12).toString('hex');
      await query(`
        INSERT INTO dbo.user_feeds (id, user_id, source_id, followed_at)
        VALUES (@id, @userId, @sourceId, @now)
      `, {
        id: { type: sql.NVarChar(64), value: userFeedId },
        userId: { type: sql.NVarChar(64), value: userId },
        sourceId: { type: sql.NVarChar(64), value: targetSourceId },
        now: { type: sql.BigInt, value: now }
      });
    }

    // If folderId is specified, assign folder
    if (folderId) {
      const ufaId = 'ufa_' + crypto.randomBytes(12).toString('hex');
      await query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.user_feed_assignments WHERE user_feed_id = @userFeedId AND folder_id = @folderId)
        BEGIN
          INSERT INTO dbo.user_feed_assignments (id, user_feed_id, folder_id, assigned_at)
          VALUES (@id, @userFeedId, @folderId, @now)
        END
      `, {
        id: { type: sql.NVarChar(64), value: ufaId },
        userFeedId: { type: sql.NVarChar(64), value: userFeedId },
        folderId: { type: sql.NVarChar(64), value: folderId },
        now: { type: sql.BigInt, value: now }
      });
    }

    return { success: true, user_feed_id: userFeedId, source_id: targetSourceId };
  }

  /**
   * Unsubscribe from feed
   */
  async unsubscribeFeed(userId, sourceId) {
    await query(`
      DECLARE @ufId NVARCHAR(64);
      SELECT @ufId = id FROM dbo.user_feeds WHERE user_id = @userId AND source_id = @sourceId;

      IF @ufId IS NOT NULL
      BEGIN
        DELETE FROM dbo.user_feed_assignments WHERE user_feed_id = @ufId;
        DELETE FROM dbo.user_feeds WHERE id = @ufId;
      END
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      sourceId: { type: sql.NVarChar(64), value: sourceId }
    });

    return { success: true, message: 'Unsubscribed successfully.' };
  }

  /**
   * Submit feed for review / community discovery
   */
  async submitFeed({ userId = null, feedUrl, suggestedName, category = 'general', notes = '' }) {
    const submissionId = 'fsub_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();

    await query(`
      INSERT INTO dbo.feed_submissions (id, user_id, feed_url, suggested_title, category, notes, status, created_at)
      VALUES (@id, @userId, @feedUrl, @suggestedName, @category, @notes, 'pending', @now)
    `, {
      id: { type: sql.NVarChar(64), value: submissionId },
      userId: { type: sql.NVarChar(64), value: userId },
      feedUrl: { type: sql.NVarChar(1000), value: feedUrl },
      suggestedName: { type: sql.NVarChar(255), value: suggestedName || null },
      category: { type: sql.NVarChar(100), value: category },
      notes: { type: sql.NVarChar(1000), value: notes || null },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, submission_id: submissionId, message: 'Feed submission received for review.' };
  }
}

module.exports = new FeedService();
