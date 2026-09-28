/**
 * FeedOmeter 2.1 — AlertService
 * Domain Service for User Realtime Alerts, Webhooks, Push Subscriptions & Delivery Dispatches
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class AlertService {
  /**
   * Get all active & inactive alerts for a user
   */
  async getUserAlerts(userId) {
    const res = await query(`
      SELECT 
        a.id, a.name, a.alert_type, a.config_json,
        a.delivery_channels AS delivery_channel, a.delivery_channels,
        a.is_active, a.created_at, a.updated_at
      FROM dbo.user_alerts a
      WHERE a.user_id = @userId
      ORDER BY a.created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return (res.recordset || []).map((row) => {
      let parsedConfig = {};
      try { parsedConfig = JSON.parse(row.config_json || '{}'); } catch (_) {}
      return {
        ...row,
        target_id: parsedConfig.target_id || null,
        condition_type: parsedConfig.condition_type || 'contains',
        threshold_value: parsedConfig.threshold_value || null,
        trigger_count: parsedConfig.trigger_count || 0,
        last_triggered_at: parsedConfig.last_triggered_at || null
      };
    });
  }

  /**
   * Create an alert
   */
  async createAlert(userId, { name, alertType = 'keyword', targetId = null, conditionType = 'contains', thresholdValue = null, deliveryChannel = 'in_app' }) {
    const alertId = 'alt_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    const configJson = JSON.stringify({
      target_id: targetId,
      condition_type: conditionType,
      threshold_value: thresholdValue,
      trigger_count: 0,
      last_triggered_at: null
    });

    await query(`
      INSERT INTO dbo.user_alerts (id, user_id, name, alert_type, config_json, delivery_channels, is_active, created_at, updated_at)
      VALUES (@id, @userId, @name, @alertType, @configJson, @deliveryChannels, 1, @now, @now)
    `, {
      id: { type: sql.NVarChar(64), value: alertId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(255), value: name.trim() },
      alertType: { type: sql.NVarChar(30), value: alertType },
      configJson: { type: sql.NVarChar(sql.MAX), value: configJson },
      deliveryChannels: { type: sql.NVarChar(255), value: deliveryChannel },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, id: alertId, name };
  }

  /**
   * Toggle or update alert
   */
  async updateAlert(userId, alertId, { isActive, name, deliveryChannel }) {
    const now = Date.now();
    await query(`
      UPDATE dbo.user_alerts
      SET
        is_active = COALESCE(@isActive, is_active),
        name = COALESCE(@name, name),
        delivery_channels = COALESCE(@channel, delivery_channels),
        updated_at = @now
      WHERE id = @alertId AND user_id = @userId
    `, {
      alertId: { type: sql.NVarChar(64), value: alertId },
      userId: { type: sql.NVarChar(64), value: userId },
      isActive: { type: sql.TinyInt, value: isActive !== undefined ? (isActive ? 1 : 0) : null },
      name: { type: sql.NVarChar(255), value: name ? name.trim() : null },
      channel: { type: sql.NVarChar(255), value: deliveryChannel || null },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, message: 'Alert updated successfully.' };
  }

  /**
   * Delete alert
   */
  async deleteAlert(userId, alertId) {
    await query(`
      DELETE FROM dbo.alert_deliveries WHERE alert_id = @alertId;
      DELETE FROM dbo.user_alerts WHERE id = @alertId AND user_id = @userId;
    `, {
      alertId: { type: sql.NVarChar(64), value: alertId },
      userId: { type: sql.NVarChar(64), value: userId }
    });

    return { success: true, message: 'Alert deleted successfully.' };
  }

  /**
   * Record alert delivery attempt
   */
  async recordAlertDelivery({ alertId, articleId = null, channel = 'in_app', status = 'sent', errorMessage = null }) {
    const deliveryId = 'ald_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();

    await query(`
      INSERT INTO dbo.alert_deliveries (id, alert_id, article_id, channel, status, attempt_count, locked_until, sent_at, error_message, created_at)
      VALUES (@id, @alertId, @articleId, @channel, @status, 1, 0, @now, @error, @now)
    `, {
      id: { type: sql.NVarChar(64), value: deliveryId },
      alertId: { type: sql.NVarChar(64), value: alertId },
      articleId: { type: sql.NVarChar(64), value: articleId },
      channel: { type: sql.NVarChar(30), value: channel },
      status: { type: sql.NVarChar(20), value: status },
      error: { type: sql.NVarChar(1000), value: errorMessage },
      now: { type: sql.BigInt, value: now }
    });
  }

  /**
   * Get user webhooks
   */
  async getUserWebhooks(userId) {
    const res = await query(`
      SELECT 
        w.id, w.name, w.target_url, w.target_url AS url, w.secret_key, w.config_json,
        w.cadence, w.format_type, w.is_active, w.created_at
      FROM dbo.user_webhooks w
      WHERE w.user_id = @userId
      ORDER BY w.created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return (res.recordset || []).map((row) => {
      let parsed = {};
      try { parsed = JSON.parse(row.config_json || '{}'); } catch (_) {}
      return {
        ...row,
        event_types: parsed.event_types || 'article.new'
      };
    });
  }

  /**
   * Create webhook endpoint
   */
  async createWebhook(userId, { name, url, secret = null, eventTypes = 'article.new' }) {
    const webhookId = 'whk_' + crypto.randomBytes(12).toString('hex');
    const hookSecret = secret || crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const configJson = JSON.stringify({ event_types: eventTypes });

    await query(`
      INSERT INTO dbo.user_webhooks (id, user_id, name, target_url, secret_key, config_json, cadence, format_type, is_active, created_at)
      VALUES (@id, @userId, @name, @url, @secret, @configJson, 'realtime', 'standard', 1, @now)
    `, {
      id: { type: sql.NVarChar(64), value: webhookId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(255), value: name.trim() },
      url: { type: sql.NVarChar(1000), value: url.trim() },
      secret: { type: sql.NVarChar(255), value: hookSecret },
      configJson: { type: sql.NVarChar(sql.MAX), value: configJson },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, id: webhookId, secret: hookSecret };
  }
}

module.exports = new AlertService();
