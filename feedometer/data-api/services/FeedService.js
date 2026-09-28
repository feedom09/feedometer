/**
 * FeedOmeter 2.1 — FeedService
 * Domain Service for RSS/Atom Source Directory, Subscriptions & Ingestion Lifecycle
 */

const crypto = require('crypto');
const { query, sql, getPool } = require('../config/db');

function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch (_) {
    return null;
  }
}

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
        uf.id AS subscription_id,
        uf.id AS user_feed_id,
        uf.followed_at,
        ufa.folder_id,
        f.name AS folder_name,
        f.icon AS folder_icon,
        s.id AS source_id,
        s.title AS title,
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
      LEFT JOIN dbo.user_feed_assignments ufa
        ON ufa.feed_id = uf.source_id AND ufa.user_id = uf.user_id
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
      const sourceId = 'src_' + crypto.randomBytes(12).toString('hex');
      const sourceHost = getHostname(siteUrl || cleanFeedUrl);
      if (!sourceHost) throw new Error('A valid feed or website URL is required.');
      const pool = await getPool();
      const transaction = new sql.Transaction(pool);

      try {
        await transaction.begin();
        const request = new sql.Request(transaction);
        request.input('id', sql.NVarChar(64), sourceId);
        request.input('host', sql.NVarChar(255), sourceHost);
        request.input('title', sql.NVarChar(255), title || sourceHost || 'Custom Feed');
        request.input('feedUrl', sql.NVarChar(1000), cleanFeedUrl);
        request.input('siteUrl', sql.NVarChar(1000), siteUrl || cleanFeedUrl);
        request.input('category', sql.NVarChar(100), category);

        const result = await request.query(`
          DECLARE @sourceId NVARCHAR(64);
          DECLARE @publisherDomain NVARCHAR(255);

          SELECT @sourceId = id
          FROM dbo.sources WITH (UPDLOCK, HOLDLOCK)
          WHERE feed_url = @feedUrl;

          IF @sourceId IS NULL
          BEGIN
            -- Prefer the most specific existing publisher. This allows, for
            -- example, feeds.bbc.co.uk to reuse the bbc.co.uk publisher.
            SELECT TOP (1) @publisherDomain = domain
            FROM dbo.publishers WITH (UPDLOCK, HOLDLOCK)
            WHERE domain = @host OR @host LIKE '%.' + domain
            ORDER BY LEN(domain) DESC;

            IF @publisherDomain IS NULL
            BEGIN
              SET @publisherDomain = @host;
              INSERT INTO dbo.publishers (domain, name, category, is_popular)
              VALUES (@publisherDomain, @title, @category, 0);
            END

            SET @sourceId = @id;
            INSERT INTO dbo.sources (id, publisher_domain, title, feed_url, website_url, source_type, category, language, is_verified, article_count, status)
            VALUES (@sourceId, @publisherDomain, @title, @feedUrl, @siteUrl, 'rss', @category, 'en', 0, 0, 'active');
          END

          SELECT @sourceId AS source_id;
        `);

        await transaction.commit();
        targetSourceId = result.recordset[0].source_id;
      } catch (err) {
        if (transaction._aborted !== true) await transaction.rollback();
        throw err;
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
        IF NOT EXISTS (SELECT 1 FROM dbo.user_feed_assignments WHERE user_id = @userId AND feed_id = @sourceId AND folder_id = @folderId)
        BEGIN
          INSERT INTO dbo.user_feed_assignments (id, user_id, feed_id, folder_id, assigned_at)
          VALUES (@id, @userId, @sourceId, @folderId, @now)
        END
      `, {
        id: { type: sql.NVarChar(64), value: ufaId },
        userId: { type: sql.NVarChar(64), value: userId },
        userFeedId: { type: sql.NVarChar(64), value: userFeedId },
        sourceId: { type: sql.NVarChar(64), value: targetSourceId },
        folderId: { type: sql.NVarChar(64), value: folderId },
        now: { type: sql.BigInt, value: now }
      });
    }

    const countResult = await query(`
      SELECT COUNT(*) AS subscription_count FROM dbo.user_feeds WHERE user_id = @userId
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return {
      success: true,
      subscription_id: userFeedId,
      user_feed_id: userFeedId,
      source_id: targetSourceId,
      subscription_count: Number(countResult.recordset?.[0]?.subscription_count || 0)
    };
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
        DELETE FROM dbo.user_feed_assignments WHERE user_id = @userId AND feed_id = @sourceId;
        DELETE FROM dbo.user_feeds WHERE id = @ufId;
      END
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      sourceId: { type: sql.NVarChar(64), value: sourceId }
    });

    const countResult = await query(`
      SELECT COUNT(*) AS subscription_count FROM dbo.user_feeds WHERE user_id = @userId
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return {
      success: true,
      message: 'Unsubscribed successfully.',
      subscription_count: Number(countResult.recordset?.[0]?.subscription_count || 0)
    };
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
