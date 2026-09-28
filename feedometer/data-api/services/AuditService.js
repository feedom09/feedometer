/**
 * FeedOmeter 2.1 — AuditService
 * Domain Service for Security Logs, User Activity Auditing & Compliance Tracking
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class AuditService {
  /**
   * Record a security or user action audit log entry
   */
  async log({ userId = null, action, details = {}, ipAddress = null, userAgent = null }) {
    const logId = 'aud_' + crypto.randomBytes(12).toString('hex');
    const detailsJson = typeof details === 'string' ? details : JSON.stringify(details);
    const now = Date.now();

    try {
      await query(`
        INSERT INTO dbo.user_audit_logs (id, user_id, event_type, metadata, ip_address, user_agent, created_at)
        VALUES (@id, @userId, @eventType, @metadata, @ip, @ua, @now)
      `, {
        id: { type: sql.NVarChar(64), value: logId },
        userId: { type: sql.NVarChar(64), value: userId },
        eventType: { type: sql.NVarChar(100), value: action },
        metadata: { type: sql.NVarChar(sql.MAX), value: detailsJson },
        ip: { type: sql.NVarChar(45), value: ipAddress },
        ua: { type: sql.NVarChar(512), value: userAgent },
        now: { type: sql.BigInt, value: now }
      });
      return { success: true, logId };
    } catch (err) {
      console.error('[Audit Log Error]', err.message);
      return { success: false };
    }
  }

  /**
   * Get audit logs for user or admin
   */
  async getLogs({ userId = null, action = null, limit = 50, offset = 0 } = {}) {
    let whereConditions = [];
    const params = {
      limit: { type: sql.Int, value: Math.min(100, Number(limit)) },
      offset: { type: sql.Int, value: Number(offset) || 0 }
    };

    if (userId) {
      whereConditions.push(`ual.user_id = @userId`);
      params.userId = { type: sql.NVarChar(64), value: userId };
    }

    if (action) {
      whereConditions.push(`ual.event_type = @eventType`);
      params.eventType = { type: sql.NVarChar(100), value: action };
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const res = await query(`
      SELECT 
        ual.id, ual.user_id, ual.event_type AS action, ual.metadata AS details_json, ual.ip_address, ual.user_agent, ual.created_at,
        u.email, u.display_name AS name
      FROM dbo.user_audit_logs ual
      LEFT JOIN dbo.users u ON ual.user_id = u.id
      ${whereSql}
      ORDER BY ual.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    return res.recordset || [];
  }
}

module.exports = new AuditService();
