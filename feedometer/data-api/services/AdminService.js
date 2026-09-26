/**
 * FeedOmeter 2.1 — AdminService
 * Domain Service for System Operations, User Administration & Publisher Management
 */

const { query, sql } = require('../config/db');

class AdminService {
  /**
   * Get high-level platform telemetry metrics
   */
  async getSystemMetrics() {
    const metrics = await query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.users) AS total_users,
        (SELECT COUNT(*) FROM dbo.users WHERE status = 'active') AS active_users,
        (SELECT COUNT(*) FROM dbo.sources) AS total_sources,
        (SELECT COUNT(*) FROM dbo.sources WHERE status = 'active') AS active_sources,
        (SELECT COUNT(*) FROM dbo.articles) AS total_articles,
        (SELECT COUNT(*) FROM dbo.publishers) AS total_publishers,
        (SELECT COUNT(*) FROM dbo.user_alerts WHERE is_active = 1) AS active_alerts,
        (SELECT COUNT(*) FROM dbo.user_sessions WHERE expires_at > CAST(DATEDIFF_BIG(s, '1970-01-01', GETUTCDATE()) AS BIGINT) * 1000) AS active_sessions,
        (SELECT COUNT(*) FROM dbo.feed_submissions WHERE status = 'pending') AS pending_feed_submissions,
        (SELECT COUNT(*) FROM dbo.notify_signups) AS total_waitlist_signups
    `);

    return metrics.recordset ? metrics.recordset[0] : {};
  }

  /**
   * List platform users with filtering and pagination
   */
  async listUsers({ page = 1, limit = 50, status = null, search = null } = {}) {
    const offset = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));
    let whereConditions = [];
    const params = {
      offset: { type: sql.Int, value: offset },
      limit: { type: sql.Int, value: Math.min(100, Number(limit)) }
    };

    if (status && status !== 'all') {
      whereConditions.push(`u.status = @status`);
      params.status = { type: sql.NVarChar(20), value: status };
    }

    if (search && search.trim()) {
      whereConditions.push(`(u.email LIKE @search OR u.display_name LIKE @search)`);
      params.search = { type: sql.NVarChar(255), value: `%${search.trim()}%` };
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*) AS total FROM dbo.users u ${whereSql}`, params);
    const total = countRes.recordset ? countRes.recordset[0].total : 0;

    const users = await query(`
      SELECT 
        u.id, u.email, u.display_name, u.[plan], u.status, u.email_verified, u.created_at, u.last_login,
        (SELECT COUNT(*) FROM dbo.user_feeds uf WHERE uf.user_id = u.id) AS subscribed_feeds_count
      FROM dbo.users u
      ${whereSql}
      ORDER BY u.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    return {
      total,
      page: Number(page),
      limit: Number(limit),
      users: users.recordset || []
    };
  }

  /**
   * Update user status or plan tier
   */
  async updateUserAccount(userId, { status, plan }) {
    const now = Date.now();
    await query(`
      UPDATE dbo.users
      SET
        status = COALESCE(@status, status),
        [plan] = COALESCE(@plan, [plan]),
        updated_at = @now
      WHERE id = @userId
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      status: { type: sql.NVarChar(20), value: status || null },
      plan: { type: sql.NVarChar(20), value: plan || null },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, message: 'User updated successfully.' };
  }

  /**
   * Publisher management: list publishers
   */
  async listPublishers() {
    const res = await query(`
      SELECT 
        p.domain, p.name, p.category, p.logo_url, p.bg_color, p.is_popular, p.popularity_rank,
        (SELECT COUNT(*) FROM dbo.sources s WHERE s.publisher_domain = p.domain) AS source_count
      FROM dbo.publishers p
      ORDER BY p.is_popular DESC, p.name ASC
    `);

    return res.recordset || [];
  }

  /**
   * Upsert publisher
   */
  async upsertPublisher({ domain, name, category = 'General', logoUrl = null, isPopular = false, bgColor = null }) {
    await query(`
      IF EXISTS (SELECT 1 FROM dbo.publishers WHERE domain = @domain)
      BEGIN
        UPDATE dbo.publishers
        SET name = @name, category = @category, logo_url = @logoUrl, is_popular = @isPopular, bg_color = @bgColor
        WHERE domain = @domain
      END
      ELSE
      BEGIN
        INSERT INTO dbo.publishers (domain, name, category, logo_url, is_popular, bg_color)
        VALUES (@domain, @name, @category, @logoUrl, @isPopular, @bgColor)
      END
    `, {
      domain: { type: sql.NVarChar(255), value: domain.trim().toLowerCase() },
      name: { type: sql.NVarChar(255), value: name.trim() },
      category: { type: sql.NVarChar(100), value: category },
      logoUrl: { type: sql.NVarChar(1000), value: logoUrl },
      isPopular: { type: sql.TinyInt, value: isPopular ? 1 : 0 },
      bgColor: { type: sql.NVarChar(30), value: bgColor }
    });

    return { success: true, message: 'Publisher saved.' };
  }
}

module.exports = new AdminService();
