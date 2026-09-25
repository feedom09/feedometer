/**
 * workers/modules/alerts.js — FeedOmeter User Alerts & Push Subscriptions HTTP Route Handlers
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { testAlertMatch } from '../services/alert-dispatcher.js';

export async function handleListAlerts(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT ua.id, ua.name, ua.alert_type, ua.config_json, ua.delivery_channels, ua.is_active, ua.created_at,
             COUNT(ad.id) as total_notifications,
             MAX(ad.created_at) as last_notified_at
      FROM user_alerts ua
      LEFT JOIN alert_deliveries ad ON ad.alert_id = ua.id
      WHERE ua.user_id = ?
      GROUP BY ua.id
      ORDER BY ua.created_at DESC
    `).bind(session.userId).all();

    const alerts = (rows.results || []).map(a => {
      let config = {};
      let delivery_channels = ['in_app'];
      try { config = JSON.parse(a.config_json || '{}'); } catch (_) {}
      try { delivery_channels = JSON.parse(a.delivery_channels || '["in_app"]'); } catch (_) {}
      return {
        id: a.id,
        name: a.name,
        alert_type: a.alert_type,
        config,
        delivery_channels,
        is_active: Boolean(a.is_active),
        created_at: a.created_at,
        stats: {
          total_notifications: a.total_notifications || 0,
          last_notified_at: a.last_notified_at
        }
      };
    });

    return jsonResponse({ status: 'success', alerts });
  } catch (err) {
    return errorResponse('Failed to list alerts: ' + err.message, 500);
  }
}

export async function handleCreateAlert(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const body = await request.json();
    const name = String(body.name || 'My Alert').trim();
    const alertType = String(body.alert_type || 'keyword').trim();
    const config = body.config || body.config_json || {};
    const deliveryChannels = Array.isArray(body.delivery_channels) ? body.delivery_channels : ['in_app'];
    const supportedChannels = new Set(['in_app', 'email']);
    if (deliveryChannels.length === 0 || deliveryChannels.some(channel => !supportedChannels.has(channel))) {
      return errorResponse('Choose in-app or email alert delivery.', 409, 'DELIVERY_CHANNEL_NOT_CONFIGURED');
    }
    if (deliveryChannels.includes('email') && !env.RESEND_API_KEY) return errorResponse('Email delivery is not configured for this environment.', 409, 'EMAIL_NOT_CONFIGURED');

    const alertId = `alt_${generateRandomHex(12)}`;
    const configJson = typeof config === 'string' ? config : JSON.stringify(config);
    const channelsJson = typeof deliveryChannels === 'string' ? deliveryChannels : JSON.stringify(deliveryChannels);
    const now = Date.now();

    await env.DB.prepare(`
      INSERT INTO user_alerts (id, user_id, name, alert_type, config_json, delivery_channels, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(alertId, session.userId, name, alertType, configJson, channelsJson, now, now).run();

    return jsonResponse({
      status: 'success',
      message: 'Alert created successfully',
      alert: {
        id: alertId,
        name,
        alert_type: alertType,
        config: typeof config === 'object' ? config : {},
        delivery_channels: deliveryChannels,
        is_active: true,
        created_at: now
      }
    }, 201);
  } catch (err) {
    return errorResponse('Failed to create alert: ' + err.message, 500);
  }
}

export async function handleDeleteAlert(request, alertId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    await env.DB.prepare('DELETE FROM user_alerts WHERE id = ? AND user_id = ?')
      .bind(alertId, session.userId).run();
    return jsonResponse({ status: 'success', message: 'Alert deleted successfully' });
  } catch (err) {
    return errorResponse('Failed to delete alert: ' + err.message, 500);
  }
}

export async function handleTestAlert(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const body = await request.json();
    const config = body.config || body;
    const result = await testAlertMatch(env, config, 25);
    return jsonResponse({ status: 'success', result });
  } catch (err) {
    return errorResponse('Failed to test alert: ' + err.message, 500);
  }
}

export async function handleListNotifications(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT ad.id, ad.alert_id, ad.article_id, ad.channel, ad.status, ad.created_at,
             ua.name as alert_name,
             a.title as article_title, a.url as article_url, a.snippet as article_snippet, a.image_url as article_image, a.published_at
      FROM alert_deliveries ad
      JOIN user_alerts ua ON ua.id = ad.alert_id
      LEFT JOIN articles a ON a.id = ad.article_id
      WHERE ua.user_id = ?
      ORDER BY ad.created_at DESC
      LIMIT 50
    `).bind(session.userId).all();

    return jsonResponse({ status: 'success', notifications: rows.results || [] });
  } catch (err) {
    return errorResponse('Failed to fetch notifications: ' + err.message, 500);
  }
}

export async function handleSubscribePush(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return errorResponse('Web Push is not configured for this environment.', 409, 'PUSH_NOT_CONFIGURED');
  }

  try {
    const body = await request.json();
    const endpoint = String(body.endpoint || '').trim();
    const p256dh = String(body.p256dh || (body.keys && body.keys.p256dh) || '').trim();
    const authKey = String(body.auth || (body.keys && body.keys.auth) || '').trim();
    const userAgent = request.headers.get('User-Agent') || '';

    if (!endpoint || !p256dh || !authKey) {
      return errorResponse('Endpoint, p256dh and auth keys are required for Web Push', 400);
    }

    const subId = `psh_${generateRandomHex(12)}`;
    await env.DB.prepare(`
      INSERT INTO user_push_subscriptions (id, user_id, endpoint, p256dh, auth_key, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(subId, session.userId, endpoint, p256dh, authKey, userAgent, Date.now()).run();

    return jsonResponse({ status: 'success', message: 'Push subscription registered successfully' });
  } catch (err) {
    return errorResponse('Failed to register push subscription: ' + err.message, 500);
  }
}
