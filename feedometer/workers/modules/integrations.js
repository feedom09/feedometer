/**
 * workers/modules/integrations.js — FeedOmeter Integrations Marketplace Edge Route Handlers
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { dispatchIntegrationTestPing, isSupportedIntegration } from '../integrations/integration-registry.js';
import { normalizeExternalHttpUrl } from '../services/source-intake.js';

/**
 * GET /api/integrations/catalog — List all marketplace integration definitions
 */
export async function handleListCatalog(request, env) {
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT id, code, name, category, icon, logo_url, description, badge, setup_type, display_order, is_active
      FROM integrations
      WHERE is_active = 1
      ORDER BY display_order ASC, name ASC
    `).all();

    const catalog = (rows.results || []).map((integration) => ({
      ...integration,
      available: isSupportedIntegration(integration.code)
    }));
    return jsonResponse({
      status: 'success',
      count: catalog.length,
      catalog
    });
  } catch (err) {
    return errorResponse(`Failed to load integrations catalog: ${err.message}`, 500);
  }
}

/**
 * GET /api/integrations — List user connected integrations
 */
export async function handleListUserIntegrations(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT 
        ui.id,
        ui.name,
        ui.config_json,
        ui.status,
        ui.last_used_at,
        ui.last_error,
        ui.connected_at,
        i.id AS integration_id,
        i.code AS integration_code,
        i.name AS integration_name,
        i.category AS integration_category,
        i.icon AS integration_icon,
        i.badge AS integration_badge
      FROM user_integrations ui
      JOIN integrations i ON ui.integration_id = i.id
      WHERE ui.user_id = ?
      ORDER BY ui.connected_at DESC
    `).bind(session.userId).all();

    const connections = (rows.results || []).map(r => {
      let config = {};
      try { config = JSON.parse(r.config_json || '{}'); } catch (_) {}
      return {
        id: r.id,
        name: r.name,
        integration_id: r.integration_id,
        integration_code: r.integration_code,
        integration_name: r.integration_name,
        integration_category: r.integration_category,
        integration_icon: r.integration_icon,
        integration_badge: r.integration_badge,
        status: r.status,
        config: {
          channel: config.channel || '',
          workspace: config.workspace || '',
          webhookUrlMasked: config.webhookUrl ? config.webhookUrl.slice(0, 24) + '...' : '',
          alertEnabled: Boolean(config.alertEnabled !== false),
          digestEnabled: Boolean(config.digestEnabled !== false),
          keywords: config.keywords || []
        },
        last_used_at: r.last_used_at,
        last_error: r.last_error,
        connected_at: r.connected_at
      };
    });

    return jsonResponse({
      status: 'success',
      count: connections.length,
      connections
    });
  } catch (err) {
    return errorResponse(`Failed to load connected integrations: ${err.message}`, 500);
  }
}

/**
 * POST /api/integrations — Connect a new marketplace integration
 */
export async function handleCreateUserIntegration(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const integrationCode = String(body.integration_code || body.code || 'slack').trim().toLowerCase();
    if (!isSupportedIntegration(integrationCode)) {
      return errorResponse('This integration is not available yet. Supported connections are Slack, Microsoft Teams, and Custom Webhook.', 409, 'INTEGRATION_NOT_AVAILABLE');
    }
    const name = String(body.name || `${integrationCode.toUpperCase()} Channel`).trim();
    const config = body.config || {};
    const webhookValidation = normalizeExternalHttpUrl(config.webhookUrl || body.webhookUrl || body.target_url || '');
    const webhookUrl = webhookValidation.ok ? webhookValidation.url : '';

    if (!webhookValidation.ok) return errorResponse(webhookValidation.message, 400, webhookValidation.code);

    // Lookup integration_id from code
    const integration = await env.DB.prepare('SELECT id, name FROM integrations WHERE code = ?')
      .bind(integrationCode).first();
    if (!integration) {
      return errorResponse(`Unsupported integration type: ${integrationCode}`, 400);
    }

    const connectionId = `uint_${generateRandomHex(12)}`;
    const now = Date.now();
    const configJson = JSON.stringify({
      webhookUrl,
      channel: String(config.channel || '').trim(),
      workspace: String(config.workspace || '').trim(),
      alertEnabled: Boolean(config.alertEnabled !== false),
      digestEnabled: Boolean(config.digestEnabled !== false),
      keywords: Array.isArray(config.keywords) ? config.keywords : (config.keywords ? String(config.keywords).split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : []),
      secretKey: `intsec_${generateRandomHex(16)}`
    });

    await env.DB.prepare(`
      INSERT INTO user_integrations (id, user_id, integration_id, name, config_json, status, connected_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(connectionId, session.userId, integration.id, name, configJson, now, now).run();

    return jsonResponse({
      status: 'success',
      message: `${integration.name} connected successfully`,
      connection: {
        id: connectionId,
        integration_code: integrationCode,
        name,
        status: 'active',
        connected_at: now
      }
    }, 201);
  } catch (err) {
    return errorResponse(`Failed to connect integration: ${err.message}`, 500);
  }
}

/**
 * POST /api/integrations/test-direct — Test an integration URL directly before saving
 */
export async function handleTestDirectIntegration(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');

  try {
    const body = await request.json();
    const integrationCode = String(body.integration_code || body.code || 'slack').trim().toLowerCase();
    if (!isSupportedIntegration(integrationCode)) {
      return errorResponse('This integration is not available yet.', 409, 'INTEGRATION_NOT_AVAILABLE');
    }
    const webhookValidation = normalizeExternalHttpUrl(body.webhookUrl || body.url || body.target_url || '');
    const webhookUrl = webhookValidation.ok ? webhookValidation.url : '';
    const channelName = String(body.channel || 'Test Channel').trim();

    if (!webhookValidation.ok) return errorResponse(webhookValidation.message, 400, webhookValidation.code);

    const result = await dispatchIntegrationTestPing(integrationCode, webhookUrl, channelName);
    return jsonResponse({
      status: result.ok ? 'success' : 'error',
      result
    });
  } catch (err) {
    return errorResponse(`Test ping failed: ${err.message}`, 500);
  }
}

/**
 * POST /api/integrations/:id/test — Send test ping to an existing connection
 */
export async function handleTestUserIntegration(request, env, connectionId) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const row = await env.DB.prepare(`
      SELECT ui.id, ui.name, ui.config_json, i.code AS integration_code
      FROM user_integrations ui
      JOIN integrations i ON ui.integration_id = i.id
      WHERE ui.id = ? AND ui.user_id = ?
    `).bind(connectionId, session.userId).first();

    if (!row) return errorResponse('Integration connection not found', 404);
    if (!isSupportedIntegration(row.integration_code)) {
      return errorResponse('This integration is not available yet.', 409, 'INTEGRATION_NOT_AVAILABLE');
    }

    const config = JSON.parse(row.config_json || '{}');
    const webhookValidation = normalizeExternalHttpUrl(config.webhookUrl || '');
    if (!webhookValidation.ok) return errorResponse(webhookValidation.message, 400, webhookValidation.code);
    const result = await dispatchIntegrationTestPing(row.integration_code, webhookValidation.url, row.name);

    if (result.ok) {
      await env.DB.prepare('UPDATE user_integrations SET last_used_at = ?, last_error = NULL, status = ? WHERE id = ?')
        .bind(Date.now(), 'active', connectionId).run();
    } else {
      await env.DB.prepare('UPDATE user_integrations SET last_error = ? WHERE id = ?')
        .bind(`HTTP ${result.status}: ${result.statusText}`, connectionId).run();
    }

    return jsonResponse({
      status: result.ok ? 'success' : 'error',
      result
    });
  } catch (err) {
    return errorResponse(`Test ping failed: ${err.message}`, 500);
  }
}

/**
 * DELETE /api/integrations/:id — Disconnect integration
 */
export async function handleDeleteUserIntegration(request, env, connectionId) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const result = await env.DB.prepare('DELETE FROM user_integrations WHERE id = ? AND user_id = ?')
      .bind(connectionId, session.userId).run();

    return jsonResponse({
      status: 'success',
      message: 'Integration disconnected successfully',
      deleted: result.changes > 0
    });
  } catch (err) {
    return errorResponse(`Failed to disconnect integration: ${err.message}`, 500);
  }
}
