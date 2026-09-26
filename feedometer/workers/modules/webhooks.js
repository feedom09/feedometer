/**
 * workers/modules/webhooks.js — FeedOmeter Outbound Webhooks HTTP Route Handlers
 * Dual Cadence (Real-time vs Scheduled Digest), Slack Block Kit, and Telemetry.
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { testWebhookEndpoint, calculateNextWebhookRun } from '../services/webhook-dispatcher.js';
import { normalizeExternalHttpUrl } from '../services/source-intake.js';

export async function handleListWebhooks(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT uw.id, uw.name, uw.target_url, uw.config_json, uw.is_active, 
             uw.cadence, uw.schedule_time, uw.schedule_day, uw.format_type, uw.next_run_at, uw.last_cursor_at,
             uw.created_at,
             COUNT(wd.id) as total_deliveries,
             SUM(CASE WHEN wd.status = 'delivered' THEN 1 ELSE 0 END) as successful_deliveries,
             MAX(wd.delivered_at) as last_delivered_at
      FROM user_webhooks uw
      LEFT JOIN webhook_deliveries wd ON wd.webhook_id = uw.id
      WHERE uw.user_id = ?
      GROUP BY uw.id
      ORDER BY uw.created_at DESC
    `).bind(session.userId).all();

    const webhooks = (rows.results || []).map(w => {
      let config = {};
      try { config = JSON.parse(w.config_json || '{}'); } catch (_) {}
      return {
        id: w.id,
        name: w.name,
        target_url: w.target_url,
        config,
        cadence: w.cadence || 'realtime',
        schedule_time: w.schedule_time || '17:00',
        schedule_day: w.schedule_day || 'monday',
        format_type: w.format_type || 'standard',
        next_run_at: w.next_run_at || 0,
        last_cursor_at: w.last_cursor_at || 0,
        is_active: Boolean(w.is_active),
        created_at: w.created_at,
        stats: {
          total: w.total_deliveries || 0,
          successful: w.successful_deliveries || 0,
          last_delivered_at: w.last_delivered_at
        }
      };
    });

    return jsonResponse({ status: 'success', webhooks });
  } catch (err) {
    return errorResponse('Failed to list webhooks: ' + err.message, 500);
  }
}

export async function handleCreateWebhook(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const body = await request.json();
    const name = String(body.name || 'My Webhook').trim();
    const targetValidation = normalizeExternalHttpUrl(body.target_url || body.targetUrl || body.url || '');
    const targetUrl = targetValidation.ok ? targetValidation.url : '';
    const config = body.config || body.config_json || {};
    const cadence = ['realtime', 'daily', 'weekly'].includes(body.cadence) ? body.cadence : 'realtime';
    const scheduleTime = String(body.schedule_time || body.scheduleTime || '17:00').trim();
    const scheduleDay = String(body.schedule_day || body.scheduleDay || 'monday').toLowerCase().trim();
    const formatType = ['standard', 'slack'].includes(body.format_type) ? body.format_type : 'standard';

    if (!targetValidation.ok) {
      return errorResponse(targetValidation.message, 400, targetValidation.code);
    }

    const webhookId = `whk_${generateRandomHex(12)}`;
    const secretKey = `whsec_${generateRandomHex(24)}`;
    const configJson = typeof config === 'string' ? config : JSON.stringify(config);
    const now = Date.now();
    const nextRunAt = cadence !== 'realtime' ? calculateNextWebhookRun(cadence, scheduleTime, scheduleDay) : 0;

    await env.DB.prepare(`
      INSERT INTO user_webhooks (id, user_id, name, target_url, secret_key, config_json, cadence, schedule_time, schedule_day, format_type, next_run_at, last_cursor_at, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(
      webhookId,
      session.userId,
      name,
      targetUrl,
      secretKey,
      configJson,
      cadence,
      scheduleTime,
      scheduleDay,
      formatType,
      nextRunAt,
      now,
      now
    ).run();

    return jsonResponse({
      status: 'success',
      message: 'Webhook created successfully',
      webhook: {
        id: webhookId,
        name,
        target_url: targetUrl,
        secret_key: secretKey,
        config: typeof config === 'object' ? config : {},
        cadence,
        schedule_time: scheduleTime,
        schedule_day: scheduleDay,
        format_type: formatType,
        next_run_at: nextRunAt,
        is_active: true,
        created_at: now
      }
    }, 201);
  } catch (err) {
    return errorResponse('Failed to create webhook: ' + err.message, 500);
  }
}

export async function handleUpdateWebhook(request, webhookId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const body = await request.json();
    const webhook = await env.DB.prepare('SELECT * FROM user_webhooks WHERE id = ? AND user_id = ?')
      .bind(webhookId, session.userId).first();
    if (!webhook) return errorResponse('Webhook not found', 404, 'NOT_FOUND');

    const updates = [];
    const values = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(String(body.name).trim());
    }
    if (body.target_url !== undefined) {
      const targetValidation = normalizeExternalHttpUrl(body.target_url);
      if (!targetValidation.ok) return errorResponse(targetValidation.message, 400, targetValidation.code);
      updates.push('target_url = ?');
      values.push(targetValidation.url);
    }
    if (body.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(body.is_active ? 1 : 0);
    }
    if (body.cadence !== undefined && ['realtime', 'daily', 'weekly'].includes(body.cadence)) {
      updates.push('cadence = ?');
      values.push(body.cadence);
    }
    if (body.schedule_time !== undefined) {
      updates.push('schedule_time = ?');
      values.push(String(body.schedule_time).trim());
    }
    if (body.schedule_day !== undefined) {
      updates.push('schedule_day = ?');
      values.push(String(body.schedule_day).toLowerCase().trim());
    }
    if (body.format_type !== undefined && ['standard', 'slack'].includes(body.format_type)) {
      updates.push('format_type = ?');
      values.push(body.format_type);
    }
    if (body.config !== undefined || body.config_json !== undefined) {
      updates.push('config_json = ?');
      values.push(JSON.stringify(body.config || body.config_json || {}));
    }

    // Recalculate next run if cadence or schedule changed
    const targetCadence = body.cadence || webhook.cadence;
    const targetTime = body.schedule_time || webhook.schedule_time;
    const targetDay = body.schedule_day || webhook.schedule_day;
    const nextRun = targetCadence !== 'realtime' ? calculateNextWebhookRun(targetCadence, targetTime, targetDay) : 0;
    updates.push('next_run_at = ?');
    values.push(nextRun);

    if (updates.length > 0) {
      values.push(webhookId, session.userId);
      await env.DB.prepare(`UPDATE user_webhooks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
        .bind(...values).run();
    }

    return jsonResponse({ status: 'success', message: 'Webhook updated successfully' });
  } catch (err) {
    return errorResponse('Failed to update webhook: ' + err.message, 500);
  }
}

export async function handleDeleteWebhook(request, webhookId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const webhook = await env.DB.prepare('SELECT id FROM user_webhooks WHERE id = ? AND user_id = ?')
      .bind(webhookId, session.userId).first();
    if (!webhook) return errorResponse('Webhook not found', 404, 'NOT_FOUND');

    await env.DB.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').bind(webhookId).run();
    await env.DB.prepare('DELETE FROM user_webhooks WHERE id = ? AND user_id = ?').bind(webhookId, session.userId).run();

    return jsonResponse({ status: 'success', message: 'Webhook deleted successfully' });
  } catch (err) {
    return errorResponse('Failed to delete webhook: ' + err.message, 500);
  }
}

export async function handleTestWebhook(request, webhookId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    let targetUrl = '';
    let secretKey = 'test_secret';
    let formatType = 'standard';

    if (webhookId === 'direct') {
      const body = await request.json();
      targetUrl = String(body.target_url || body.url || '').trim();
      secretKey = String(body.secret_key || 'test_secret').trim();
      formatType = body.format_type === 'slack' ? 'slack' : 'standard';
    } else {
      const webhook = await env.DB.prepare('SELECT * FROM user_webhooks WHERE id = ? AND user_id = ?')
        .bind(webhookId, session.userId).first();
      if (!webhook) return errorResponse('Webhook not found', 404, 'NOT_FOUND');
      targetUrl = webhook.target_url;
      secretKey = webhook.secret_key;
      formatType = webhook.format_type || 'standard';
    }

    const targetValidation = normalizeExternalHttpUrl(targetUrl);
    if (!targetValidation.ok) return errorResponse(targetValidation.message, 400, targetValidation.code);

    const result = await testWebhookEndpoint(targetValidation.url, secretKey, formatType);
    return jsonResponse({ status: 'success', result });
  } catch (err) {
    return errorResponse('Failed to test webhook: ' + err.message, 500);
  }
}

export async function handleGetWebhookLogs(request, webhookId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const webhook = await env.DB.prepare('SELECT id FROM user_webhooks WHERE id = ? AND user_id = ?')
      .bind(webhookId, session.userId).first();
    if (!webhook) return errorResponse('Webhook not found', 404, 'NOT_FOUND');

    const rows = await env.DB.prepare(`
      SELECT wd.id, wd.article_id, wd.status, wd.attempt_count, wd.response_code,
             wd.duration_ms, wd.delivered_at, wd.created_at,
             a.title as article_title, a.link as article_url
      FROM webhook_deliveries wd
      LEFT JOIN articles a ON a.id = wd.article_id
      WHERE wd.webhook_id = ?
      ORDER BY wd.created_at DESC
      LIMIT 50
    `).bind(webhookId).all();

    return jsonResponse({ status: 'success', logs: rows.results || [] });
  } catch (err) {
    return errorResponse('Failed to get webhook logs: ' + err.message, 500);
  }
}
