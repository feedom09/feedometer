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
        fbc.id, fbc.source_id, fbc.content_type, fbc.render_js, fbc.extraction_mode,
        fbc.selector_config_json, fbc.confidence_json, fbc.created_at, fbc.updated_at,
        s.title AS source_title, s.website_url AS target_url, s.feed_url
      FROM dbo.feed_builder_configs fbc
      LEFT JOIN dbo.sources s ON fbc.source_id = s.id
      ORDER BY fbc.updated_at DESC
    `);

    return (res.recordset || []).map((row) => {
      let parsed = {};
      try { parsed = JSON.parse(row.selector_config_json || '{}'); } catch (_) {}
      return {
        id: row.id,
        source_id: row.source_id,
        name: parsed.name || row.source_title || 'Custom Builder Feed',
        target_url: parsed.target_url || row.target_url || '',
        selectors: parsed.selectors || parsed,
        selectors_json: row.selector_config_json,
        pagination_type: parsed.pagination_type || 'none',
        content_type: row.content_type,
        render_js: row.render_js === 1,
        extraction_mode: row.extraction_mode,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });
  }

  /**
   * Save visual feed builder recipe
   */
  async saveConfig(userId, { id = null, sourceId = null, name, targetUrl, selectors, paginationType = 'none', contentType = 'news', renderJs = false, extractionMode = 'manual' }) {
    const configId = id || 'fbc_' + crypto.randomBytes(12).toString('hex');
    const targetSourceId = sourceId || 'src_vb_' + crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const selectorsObj = typeof selectors === 'string' ? JSON.parse(selectors || '{}') : (selectors || {});
    const selectorConfigJson = JSON.stringify({
      name: name.trim(),
      target_url: targetUrl.trim(),
      selectors: selectorsObj,
      pagination_type: paginationType
    });

    // Ensure dummy source entry exists if custom source
    await query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.sources WHERE id = @sourceId)
      BEGIN
        INSERT INTO dbo.sources (id, title, feed_url, website_url, source_type, category, language, is_verified, article_count, status)
        VALUES (@sourceId, @title, @feedUrl, @siteUrl, 'custom', 'general', 'en', 0, 0, 'active')
      END
    `, {
      sourceId: { type: sql.NVarChar(64), value: targetSourceId },
      title: { type: sql.NVarChar(255), value: name.trim() },
      feedUrl: { type: sql.NVarChar(1000), value: targetUrl.trim() },
      siteUrl: { type: sql.NVarChar(1000), value: targetUrl.trim() }
    });

    if (id) {
      await query(`
        UPDATE dbo.feed_builder_configs
        SET
          content_type = @contentType,
          render_js = @renderJs,
          extraction_mode = @extractionMode,
          selector_config_json = @selectorConfigJson,
          updated_at = @now
        WHERE id = @id
      `, {
        id: { type: sql.NVarChar(64), value: configId },
        contentType: { type: sql.NVarChar(30), value: contentType },
        renderJs: { type: sql.TinyInt, value: renderJs ? 1 : 0 },
        extractionMode: { type: sql.NVarChar(30), value: extractionMode },
        selectorConfigJson: { type: sql.NVarChar(sql.MAX), value: selectorConfigJson },
        now: { type: sql.BigInt, value: now }
      });
    } else {
      await query(`
        INSERT INTO dbo.feed_builder_configs (id, source_id, content_type, render_js, extraction_mode, selector_config_json, created_at, updated_at)
        VALUES (@id, @sourceId, @contentType, @renderJs, @extractionMode, @selectorConfigJson, @now, @now)
      `, {
        id: { type: sql.NVarChar(64), value: configId },
        sourceId: { type: sql.NVarChar(64), value: targetSourceId },
        contentType: { type: sql.NVarChar(30), value: contentType },
        renderJs: { type: sql.TinyInt, value: renderJs ? 1 : 0 },
        extractionMode: { type: sql.NVarChar(30), value: extractionMode },
        selectorConfigJson: { type: sql.NVarChar(sql.MAX), value: selectorConfigJson },
        now: { type: sql.BigInt, value: now }
      });
    }

    return { success: true, id: configId, name, source_id: targetSourceId };
  }

  /**
   * Delete builder recipe
   */
  async deleteConfig(userId, configId) {
    await query(`
      DELETE FROM dbo.feed_builder_configs WHERE id = @id
    `, {
      id: { type: sql.NVarChar(64), value: configId }
    });

    return { success: true, message: 'Builder configuration deleted.' };
  }

  /**
   * Get domain patterns / prebuilt extraction recipes
   */
  async getDomainPatterns(domain) {
    const res = await query(`
      SELECT domain, selector_config_json, confidence, [source], usage_count, updated_at
      FROM dbo.domain_patterns
      WHERE domain = @domain OR @domain LIKE '%' + domain
    `, { domain: { type: sql.NVarChar(255), value: domain } });

    return res.recordset || [];
  }
}

module.exports = new BuilderService();
