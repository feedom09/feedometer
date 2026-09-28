/**
 * FeedOmeter 2.1 — IntegrationService
 * Domain Service for Integrations Directory, User-connected Services, and API Keys
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class IntegrationService {
  /**
   * List all available third-party integrations (Slack, Discord, Notion, Zapier, Webhooks)
   */
  async getAvailableIntegrations() {
    const res = await query(`
      SELECT id, code, code AS slug, name, category, icon, logo_url, logo_url AS icon_url, description, badge, setup_type, setup_type AS auth_type, is_active
      FROM dbo.integrations
      WHERE is_active = 1
      ORDER BY display_order ASC, name ASC
    `);
    return res.recordset || [];
  }

  /**
   * Get user's active integrations
   */
  async getUserIntegrations(userId) {
    const res = await query(`
      SELECT 
        ui.id, ui.integration_id, ui.name, ui.config_json, ui.status, ui.last_used_at, ui.connected_at, ui.connected_at AS created_at,
        i.code, i.code AS slug, i.name AS integration_name, i.icon, i.logo_url, i.logo_url AS icon_url, i.category, i.setup_type, i.setup_type AS auth_type
      FROM dbo.user_integrations ui
      INNER JOIN dbo.integrations i ON ui.integration_id = i.id
      WHERE ui.user_id = @userId
      ORDER BY ui.connected_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Generate an API Key for user
   */
  async createApiKey(userId, { name, scopes = '["read:articles","read:sources","read:search","read:me"]', expiresDays = 365 }) {
    const keyId = 'key_' + crypto.randomBytes(8).toString('hex');
    const secretKey = 'fom_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex');
    const keyPrefix = secretKey.slice(0, 8);
    const keySuffix = secretKey.slice(-4);
    const now = Date.now();
    const expiresAt = expiresDays ? now + (expiresDays * 24 * 60 * 60 * 1000) : null;
    const permissionsJson = typeof scopes === 'string' && scopes.startsWith('[') ? scopes : JSON.stringify(scopes.split(',').map(s => s.trim()));

    await query(`
      INSERT INTO dbo.api_keys (id, user_id, name, key_prefix, key_suffix, key_hash, permissions, rate_limit_per_min, expires_at, created_at, is_active)
      VALUES (@id, @userId, @name, @keyPrefix, @keySuffix, @keyHash, @permissions, 60, @expiresAt, @now, 1)
    `, {
      id: { type: sql.NVarChar(64), value: keyId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(255), value: name.trim() },
      keyPrefix: { type: sql.NVarChar(30), value: keyPrefix },
      keySuffix: { type: sql.NVarChar(30), value: keySuffix },
      keyHash: { type: sql.NVarChar(64), value: keyHash },
      permissions: { type: sql.NVarChar(sql.MAX), value: permissionsJson },
      expiresAt: { type: sql.BigInt, value: expiresAt },
      now: { type: sql.BigInt, value: now }
    });

    return {
      success: true,
      id: keyId,
      name,
      apiKey: secretKey,
      expiresAt,
      message: 'Store your API key safely. It will not be shown again.'
    };
  }

  /**
   * List user's API keys (masked)
   */
  async listApiKeys(userId) {
    const res = await query(`
      SELECT 
        id, name, name AS key_name,
        CONCAT(key_prefix, '...', key_suffix) AS masked_key,
        permissions, permissions AS scopes, last_used_at, expires_at, created_at
      FROM dbo.api_keys
      WHERE user_id = @userId AND is_active = 1
      ORDER BY created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(userId, keyId) {
    const now = Date.now();
    await query(`
      UPDATE dbo.api_keys
      SET is_active = 0, revoked_at = @now
      WHERE id = @id AND user_id = @userId
    `, {
      id: { type: sql.NVarChar(64), value: keyId },
      userId: { type: sql.NVarChar(64), value: userId },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, message: 'API key revoked successfully.' };
  }
}

module.exports = new IntegrationService();
