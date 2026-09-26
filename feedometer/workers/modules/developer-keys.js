/**
 * workers/modules/developer-keys.js — User Dashboard API Key Management Module
 * 
 * Provides session-authenticated endpoints for users to generate, view, and revoke API keys.
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { hashApiKey, ALLOWED_API_SCOPES } from '../middleware/api-key-auth.js';

/**
 * GET /api/developer/keys — List user's active API keys (masked with prefix and suffix)
 */
export async function handleListApiKeys(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const res = await env.DB.prepare(`
      SELECT 
        id, 
        name, 
        key_prefix, 
        key_suffix, 
        permissions, 
        rate_limit_per_min, 
        last_used_at, 
        expires_at, 
        created_at,
        is_active
      FROM api_keys
      WHERE user_id = ? AND is_active = 1
      ORDER BY created_at DESC
    `).bind(session.userId).all();

    const keys = (res.results || []).map(k => {
      let permissions = [];
      try { permissions = JSON.parse(k.permissions || '[]'); } catch (_) {}
      return {
        id: k.id,
        name: k.name,
        key_prefix: k.key_prefix,
        key_suffix: k.key_suffix,
        masked_key: `${k.key_prefix}••••••••••••••••••••${k.key_suffix}`,
        permissions,
        rate_limit_per_min: k.rate_limit_per_min,
        last_used_at: k.last_used_at,
        expires_at: k.expires_at,
        is_expired: k.expires_at ? Date.now() > k.expires_at : false,
        created_at: k.created_at
      };
    });

    return jsonResponse({
      status: 'success',
      count: keys.length,
      keys
    });
  } catch (err) {
    return errorResponse(`Failed to list API keys: ${err.message}`, 500);
  }
}

/**
 * POST /api/developer/keys — Generate a new API key (returns plaintext secret ONCE)
 */
export async function handleCreateApiKey(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return errorResponse('Invalid JSON body', 400);
  }

  const name = (body.name || 'API Key').trim().slice(0, 100);
  const expiresInDays = body.expires_in_days ? parseInt(body.expires_in_days, 10) : null;
  const permissions = Array.isArray(body.permissions) && body.permissions.length > 0
    ? body.permissions
    : ['read:articles', 'read:sources', 'read:search', 'read:me'];
  if (permissions.some((scope) => !ALLOWED_API_SCOPES.has(scope))) {
    return errorResponse('One or more requested API key permissions are not supported.', 400, 'INVALID_API_SCOPE');
  }

  // 1. Generate 32-character random hex token
  const randomHex = generateRandomHex(32);
  const rawKey = `fom_live_${randomHex}`;
  const keyPrefix = `fom_live_${randomHex.slice(0, 4)}`;
  const keySuffix = randomHex.slice(-8);

  // 2. Compute SHA-256 hash for secure storage
  const keyHash = await hashApiKey(rawKey);

  // 3. Compute expiration
  const expiresAt = expiresInDays && expiresInDays > 0
    ? Date.now() + (expiresInDays * 86400000)
    : null;

  const keyId = `key_${generateRandomHex(12)}`;

  try {
    await env.DB.prepare(`
      INSERT INTO api_keys (
        id, user_id, name, key_prefix, key_suffix, key_hash, permissions, rate_limit_per_min, expires_at, created_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      keyId,
      session.userId,
      name,
      keyPrefix,
      keySuffix,
      keyHash,
      JSON.stringify(permissions),
      60, // 60 requests per minute default
      expiresAt,
      Date.now()
    ).run();

    return jsonResponse({
      status: 'success',
      message: 'API Key generated successfully. Save this secret now; it will never be displayed again.',
      key: {
        id: keyId,
        name,
        secret_token: rawKey,
        key_prefix: keyPrefix,
        key_suffix: keySuffix,
        masked_key: `${keyPrefix}••••••••••••••••••••${keySuffix}`,
        permissions,
        expires_at: expiresAt,
        created_at: Date.now()
      }
    }, 201);
  } catch (err) {
    return errorResponse(`Failed to create API key: ${err.message}`, 500);
  }
}

/**
 * DELETE /api/developer/keys/:id — Revoke an existing API key
 */
export async function handleRevokeApiKey(request, env, keyId) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  if (!keyId) return errorResponse('Missing API Key ID', 400);

  try {
    const res = await env.DB.prepare(`
      UPDATE api_keys 
      SET is_active = 0, revoked_at = ? 
      WHERE id = ? AND user_id = ?
    `).bind(Date.now(), keyId, session.userId).run();

    if (res.meta && res.meta.changes === 0) {
      return errorResponse('API Key not found or already revoked', 404);
    }

    return jsonResponse({
      status: 'success',
      message: 'API Key revoked successfully'
    });
  } catch (err) {
    return errorResponse(`Failed to revoke API key: ${err.message}`, 500);
  }
}
