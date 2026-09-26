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
      SELECT id, name, slug, description, icon_url, auth_type, docs_url, is_active
      FROM dbo.integrations
      WHERE is_active = 1
      ORDER BY name ASC
    `);
    return res.recordset || [];
  }

  /**
   * Get user's active integrations
   */
  async getUserIntegrations(userId) {
    const res = await query(`
      SELECT 
        ui.id, ui.integration_id, ui.is_active, ui.last_used_at, ui.created_at,
        i.name, i.slug, i.icon_url, i.auth_type
      FROM dbo.user_integrations ui
      INNER JOIN dbo.integrations i ON ui.integration_id = i.id
      WHERE ui.user_id = @userId
      ORDER BY ui.created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Generate an API Key for user
   */
  async createApiKey(userId, { name, scopes = 'read,write', expiresDays = 365 }) {
    const keyId = 'key_' + crypto.randomBytes(8).toString('hex');
    const secretKey = 'fom_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000) : null;

    await query(`
      INSERT INTO dbo.api_keys (id, user_id, key_name, api_key, scopes, expires_at, created_at)
      VALUES (@id, @userId, @name, @apiKey, @scopes, @expiresAt, SYSUTCDATETIME())
    `, {
      id: { type: sql.NVarChar(64), value: keyId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(128), value: name.trim() },
      apiKey: { type: sql.VarChar(128), value: secretKey },
      scopes: { type: sql.VarChar(255), value: scopes },
      expiresAt: { type: sql.DateTime2, value: expiresAt }
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
        id, key_name, 
        CONCAT(SUBSTRING(api_key, 1, 8), '...', SUBSTRING(api_key, LEN(api_key) - 3, 4)) AS masked_key,
        scopes, last_used_at, expires_at, created_at
      FROM dbo.api_keys
      WHERE user_id = @userId
      ORDER BY created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(userId, keyId) {
    await query(`DELETE FROM dbo.api_keys WHERE id = @id AND user_id = @userId`, {
      id: { type: sql.NVarChar(64), value: keyId },
      userId: { type: sql.NVarChar(64), value: userId }
    });

    return { success: true, message: 'API key revoked successfully.' };
  }
}

module.exports = new IntegrationService();
