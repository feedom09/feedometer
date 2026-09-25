/**
 * workers/middleware/api-key-auth.js — API Key Authentication & KV Rate Limiting Middleware
 * 
 * Provides cryptographic SHA-256 token verification, permission scope validation,
 * expiration checks, and zero-lock KV rate limiting for public /api/v1 endpoints.
 */

/**
 * Computes deterministic SHA-256 hex hash of the secret API key using Web Crypto
 * @param {string} apiKey - The raw plaintext API key (e.g. "fom_live_...")
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
export async function hashApiKey(apiKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const ALLOWED_API_SCOPES = new Set([
  'read:articles', 'read:sources', 'read:search', 'read:me', 'write:me'
]);

/**
 * Extracts raw API key from request headers. Query parameters are deliberately
 * not accepted because URLs are routinely retained in browser history, logs,
 * referrers, and analytics systems.
 * @param {Request} request - Incoming HTTP Request
 * @returns {string|null} Plaintext API key or null
 */
export function extractApiKey(request) {
  // 1. Authorization: Bearer fom_live_...
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith('fom_live_')) return token;
  }

  // 2. X-API-Key header
  const xApiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key');
  if (xApiKey && xApiKey.trim().startsWith('fom_live_')) {
    return xApiKey.trim();
  }

  return null;
}

/**
 * Authenticates an incoming API request using API Key and validates rate limits + scopes
 * 
 * @param {Request} request - Incoming HTTP Request
 * @param {Object} env - Cloudflare Worker environment bindings (DB, FEEDS_KV)
 * @param {string|null} requiredScope - Optional permission scope required (e.g. "read:articles", "read:me")
 * @returns {Promise<{ valid: boolean, status?: number, error?: string, apiKey?: Object, userId?: string, scopes?: string[], retryAfter?: number }>}
 */
export async function verifyApiKey(request, env, requiredScope = null) {
  if (!env.DB) {
    return { valid: false, status: 500, error: 'Database connection unavailable' };
  }

  const rawKey = extractApiKey(request);
  if (!rawKey) {
    return {
      valid: false,
      status: 401,
      error: 'Missing or malformed API key. Provide via "Authorization: Bearer fom_live_..." or "X-API-Key" header.'
    };
  }

  try {
    // 1. Compute SHA-256 hash of API key
    const keyHash = await hashApiKey(rawKey);

    // 2. Query D1 for active API key
    const apiKeyRow = await env.DB.prepare(`
      SELECT id, user_id, name, key_prefix, key_suffix, permissions, rate_limit_per_min, last_used_at, expires_at, is_active
      FROM api_keys
      WHERE key_hash = ? AND is_active = 1
    `).bind(keyHash).first();

    if (!apiKeyRow) {
      return { valid: false, status: 401, error: 'Invalid or revoked API key' };
    }

    // 3. Check expiration
    if (apiKeyRow.expires_at && Date.now() > apiKeyRow.expires_at) {
      return {
        valid: false,
        status: 401,
        error: `API key expired on ${new Date(apiKeyRow.expires_at).toISOString()}`
      };
    }

    // 4. Validate permission scopes
    let scopes = [];
    try {
      scopes = JSON.parse(apiKeyRow.permissions || '[]');
    } catch (_) {
      scopes = ['read:articles', 'read:sources', 'read:search', 'read:me'];
    }

    if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*')) {
      return {
        valid: false,
        status: 403,
        error: `Forbidden: API key lacks the required '${requiredScope}' permission scope.`
      };
    }

    // 5. Zero-Lock KV Rate Limiter (60-second sliding window)
    const limitPerMin = apiKeyRow.rate_limit_per_min || 60;
    if (env.FEEDS_KV) {
      const currentMinute = Math.floor(Date.now() / 60000);
      const kvKey = `ratelimit:apikey:${apiKeyRow.id}:${currentMinute}`;
      
      try {
        const countStr = await env.FEEDS_KV.get(kvKey);
        const currentCount = countStr ? parseInt(countStr, 10) : 0;

        if (currentCount >= limitPerMin) {
          return {
            valid: false,
            status: 429,
            error: `Rate limit exceeded. Your key is limited to ${limitPerMin} requests per minute.`,
            retryAfter: 60
          };
        }

        // Asynchronously increment counter in KV with 60s TTL
        await env.FEEDS_KV.put(kvKey, (currentCount + 1).toString(), { expirationTtl: 60 });
      } catch (kvErr) {
        // Fallback gracefully if KV is temporarily degraded
        console.warn('KV rate limiter fallback:', kvErr.message);
      }
    }

    // 6. Throttled last_used_at update (write to D1 max once every 10 minutes)
    if (!apiKeyRow.last_used_at || (Date.now() - apiKeyRow.last_used_at > 600000)) {
      env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
        .bind(Date.now(), apiKeyRow.id)
        .run()
        .catch(() => {});
    }

    return {
      valid: true,
      apiKey: apiKeyRow,
      userId: apiKeyRow.user_id,
      scopes
    };
  } catch (err) {
    return {
      valid: false,
      status: 500,
      error: `API Key verification error: ${err.message}`
    };
  }
}
