/**
 * FeedOmeter 2.1 — BuilderService
 * Domain Service for Visual Feed Builder Configurations & Custom Extraction Patterns
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class BuilderService {
  /**
   * Get user feed builder configs
   */
  async getUserConfigs(userId) {
    const res = await query(`
      SELECT 
        fbc.id, fbc.name, fbc.target_url, fbc.selectors_json, fbc.pagination_type,
        fbc.is_active, fbc.last_extracted_at, fbc.items_extracted_count, fbc.created_at, fbc.updated_at
      FROM dbo.feed_builder_configs fbc
      WHERE fbc.user_id = @userId
      ORDER BY fbc.updated_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Save visual feed builder recipe
   */
  async saveConfig(userId, { id = null, name, targetUrl, selectors, paginationType = 'none' }) {
    const configId = id || 'fbc_' + crypto.randomBytes(12).toString('hex');
    const selectorsJson = typeof selectors === 'string' ? selectors : JSON.stringify(selectors);

    if (id) {
      await query(`
        UPDATE dbo.feed_builder_configs
        SET
          name = @name,
          target_url = @targetUrl,
          selectors_json = @selectorsJson,
          pagination_type = @paginationType,
          updated_at = SYSUTCDATETIME()
        WHERE id = @id AND user_id = @userId
      `, {
        id: { type: sql.NVarChar(64), value: configId },
        userId: { type: sql.NVarChar(64), value: userId },
        name: { type: sql.NVarChar(128), value: name.trim() },
        targetUrl: { type: sql.NVarChar(1024), value: targetUrl.trim() },
        selectorsJson: { type: sql.NVarChar(sql.MAX), value: selectorsJson },
        paginationType: { type: sql.VarChar(32), value: paginationType }
      });
    } else {
      await query(`
        INSERT INTO dbo.feed_builder_configs (id, user_id, name, target_url, selectors_json, pagination_type, is_active, created_at, updated_at)
        VALUES (@id, @userId, @name, @targetUrl, @selectorsJson, @paginationType, 1, SYSUTCDATETIME(), SYSUTCDATETIME())
      `, {
        id: { type: sql.NVarChar(64), value: configId },
        userId: { type: sql.NVarChar(64), value: userId },
        name: { type: sql.NVarChar(128), value: name.trim() },
        targetUrl: { type: sql.NVarChar(1024), value: targetUrl.trim() },
        selectorsJson: { type: sql.NVarChar(sql.MAX), value: selectorsJson },
        paginationType: { type: sql.VarChar(32), value: paginationType }
      });
    }

    return { success: true, id: configId, name };
  }

  /**
   * Delete builder recipe
   */
  async deleteConfig(userId, configId) {
    await query(`
      DELETE FROM dbo.feed_builder_configs WHERE id = @id AND user_id = @userId
    `, {
      id: { type: sql.NVarChar(64), value: configId },
      userId: { type: sql.NVarChar(64), value: userId }
    });

    return { success: true, message: 'Builder configuration deleted.' };
  }

  /**
   * Get domain patterns / prebuilt extraction recipes
   */
  async getDomainPatterns(domain) {
    const res = await query(`
      SELECT domain, pattern_type, selector_rules_json, sample_url, is_verified
      FROM dbo.domain_patterns
      WHERE domain = @domain OR @domain LIKE '%' + domain
    `, { domain: { type: sql.NVarChar(255), value: domain } });

    return res.recordset || [];
  }
}

module.exports = new BuilderService();
