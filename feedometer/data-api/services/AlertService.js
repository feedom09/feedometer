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
        a.id, a.name, a.alert_type, a.target_id, a.condition_type, a.threshold_value,
        a.delivery_channel, a.is_active, a.last_triggered_at, a.trigger_count, a.created_at
      FROM dbo.user_alerts a
      WHERE a.user_id = @userId
      ORDER BY a.created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Create an alert
   */
  async createAlert(userId, { name, alertType = 'keyword', targetId = null, conditionType = 'contains', thresholdValue = null, deliveryChannel = 'in_app' }) {
    const alertId = 'alt_' + crypto.randomBytes(12).toString('hex');
    await query(`
      INSERT INTO dbo.user_alerts (id, user_id, name, alert_type, target_id, condition_type, threshold_value, delivery_channel, is_active, created_at, updated_at)
      VALUES (@id, @userId, @name, @alertType, @targetId, @conditionType, @thresholdValue, @deliveryChannel, 1, SYSUTCDATETIME(), SYSUTCDATETIME())
    `, {
      id: { type: sql.NVarChar(64), value: alertId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(128), value: name.trim() },
      alertType: { type: sql.VarChar(50), value: alertType },
      targetId: { type: sql.NVarChar(64), value: targetId },
      conditionType: { type: sql.VarChar(50), value: conditionType },
      thresholdValue: { type: sql.NVarChar(255), value: thresholdValue },
      deliveryChannel: { type: sql.VarChar(50), value: deliveryChannel }
    });

    return { success: true, id: alertId, name };
  }

  /**
   * Toggle or update alert
   */
  async updateAlert(userId, alertId, { isActive, name, deliveryChannel }) {
    await query(`
      UPDATE dbo.user_alerts
      SET
        is_active = COALESCE(@isActive, is_active),
        name = COALESCE(@name, name),
        delivery_channel = COALESCE(@channel, delivery_channel),
        updated_at = SYSUTCDATETIME()
      WHERE id = @alertId AND user_id = @userId
    `, {
      alertId: { type: sql.NVarChar(64), value: alertId },
      userId: { type: sql.NVarChar(64), value: userId },
      isActive: { type: sql.Bit, value: isActive !== undefined ? (isActive ? 1 : 0) : null },
      name: { type: sql.NVarChar(128), value: name ? name.trim() : null },
      channel: { type: sql.VarChar(50), value: deliveryChannel || null }
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
  async recordAlertDelivery({ alertId, userId, channel, status = 'delivered', payload = {}, errorMessage = null }) {
    const deliveryId = 'ald_' + crypto.randomBytes(12).toString('hex');
    await query(`
      INSERT INTO dbo.alert_deliveries (id, alert_id, user_id, channel, status, payload_json, error_message, sent_at)
      VALUES (@id, @alertId, @userId, @channel, @status, @payload, @error, SYSUTCDATETIME());

      UPDATE dbo.user_alerts
      SET last_triggered_at = SYSUTCDATETIME(), trigger_count = trigger_count + 1
      WHERE id = @alertId;
    `, {
      id: { type: sql.NVarChar(64), value: deliveryId },
      alertId: { type: sql.NVarChar(64), value: alertId },
      userId: { type: sql.NVarChar(64), value: userId },
      channel: { type: sql.VarChar(50), value: channel },
      status: { type: sql.VarChar(30), value: status },
      payload: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(payload) },
      error: { type: sql.NVarChar(1000), value: errorMessage }
    });
  }

  /**
   * Get user webhooks
   */
  async getUserWebhooks(userId) {
    const res = await query(`
      SELECT 
        w.id, w.name, w.url, w.event_types, w.is_active, w.failure_count, w.last_triggered_at, w.created_at
      FROM dbo.user_webhooks w
      WHERE w.user_id = @userId
      ORDER BY w.created_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Create webhook endpoint
   */
  async createWebhook(userId, { name, url, secret = null, eventTypes = 'article.new' }) {
    const webhookId = 'whk_' + crypto.randomBytes(12).toString('hex');
    const hookSecret = secret || crypto.randomBytes(24).toString('hex');

    await query(`
      INSERT INTO dbo.user_webhooks (id, user_id, name, url, secret, event_types, is_active, created_at, updated_at)
      VALUES (@id, @userId, @name, @url, @secret, @events, 1, SYSUTCDATETIME(), SYSUTCDATETIME())
    `, {
      id: { type: sql.NVarChar(64), value: webhookId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(128), value: name.trim() },
      url: { type: sql.NVarChar(1024), value: url.trim() },
      secret: { type: sql.NVarChar(255), value: hookSecret },
      events: { type: sql.NVarChar(255), value: eventTypes }
    });

    return { success: true, id: webhookId, secret: hookSecret };
  }
}

module.exports = new AlertService();
