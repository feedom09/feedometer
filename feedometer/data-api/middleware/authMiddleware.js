/**
 * FeedOmeter 2.1 — Authentication & Authorization Middleware
 * Handles JWT verification, Internal Edge Token validation, and API Keys
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, sql } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'feedometer_jwt_secret_key_2026_super_secure_edge_auth';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'feedometer_internal_secret_key_edge_to_data_api_2026';

/**
 * Validates JWT token or Internal Secret for protected endpoints
 */
async function requireAuth(req, res, next) {
  try {
    // 1. Check Internal API Secret (from Cloudflare Worker Edge proxy)
    const internalSecret = req.headers['x-internal-secret'];
    if (internalSecret && internalSecret === INTERNAL_API_SECRET) {
      req.isInternalEdge = true;
      if (req.headers['x-user-id']) {
        req.user = {
          id: req.headers['x-user-id'],
          role: req.headers['x-user-role'] || 'user'
        };
      }
      return next();
    }

    // 2. Check API Key
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const now = Date.now();
      const keyResult = await query(`
        SELECT ak.id, ak.user_id, ak.key_name, ak.scopes, u.email, u.display_name, u.[plan], u.status
        FROM dbo.api_keys ak
        INNER JOIN dbo.users u ON ak.user_id = u.id
        WHERE ak.api_key = @apiKey AND (ak.expires_at IS NULL OR ak.expires_at > @now)
      `, {
        apiKey: { type: sql.VarChar(128), value: apiKey },
        now: { type: sql.DateTime2, value: new Date() }
      });

      if (keyResult.recordset && keyResult.recordset.length > 0) {
        const keyData = keyResult.recordset[0];
        if (keyData.status !== 'active') {
          return res.status(403).json({ success: false, status: 'error', error: 'User account is inactive or suspended', message: 'User account is inactive' });
        }
        req.user = {
          id: keyData.user_id,
          role: (keyData.plan === 'admin' || keyData.email === 'feedom@peopledotsports.com') ? 'admin' : 'user',
          email: keyData.email,
          display_name: keyData.display_name,
          name: keyData.display_name,
          apiKeyId: keyData.id,
          scopes: keyData.scopes ? keyData.scopes.split(',') : []
        };
        query(`UPDATE dbo.api_keys SET last_used_at = SYSUTCDATETIME() WHERE id = @id`, { id: { type: sql.NVarChar(64), value: keyData.id } }).catch(() => {});
        return next();
      }
      return res.status(401).json({ success: false, status: 'error', error: 'Invalid or expired API Key', message: 'Invalid API Key' });
    }

    // 3. Check Bearer JWT Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, status: 'error', error: 'Authentication required. Missing Bearer token or API Key.', message: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    if (!token || token.trim() === '') {
      return res.status(401).json({ success: false, status: 'error', error: 'Empty token provided.', message: 'Invalid token' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      return res.status(401).json({ success: false, status: 'error', error: 'Malformed token payload.', message: 'Invalid token' });
    }

    // Check user directly from database
    const userResult = await query(`
      SELECT id, email, display_name, [plan], status, email_verified, avatar_url 
      FROM dbo.users 
      WHERE id = @userId AND status = 'active'
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    if (!userResult.recordset || userResult.recordset.length === 0) {
      return res.status(401).json({ success: false, status: 'error', error: 'Session expired or user inactive.', message: 'Session expired or user inactive' });
    }

    const u = userResult.recordset[0];
    req.user = {
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      name: u.display_name,
      plan: u.plan,
      role: (u.plan === 'admin' || u.email === 'feedom@peopledotsports.com') ? 'admin' : 'user',
      avatar_url: u.avatar_url,
      email_verified: u.email_verified === 1
    };

    // Update session last_seen in background
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = Date.now();
    query(`UPDATE dbo.user_sessions SET last_seen = @now WHERE token_hash = @hash`, {
      now: { type: sql.BigInt, value: now },
      hash: { type: sql.NVarChar(64), value: tokenHash }
    }).catch(() => {});

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, status: 'error', error: 'Token expired.', message: 'Token expired' });
    }
    return res.status(401).json({ success: false, status: 'error', error: 'Invalid authentication token: ' + err.message, message: 'Invalid authentication token' });
  }
}

/**
 * Optional authentication - extracts user if token is present, continues without error if not
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];
  const internalSecret = req.headers['x-internal-secret'];

  if (internalSecret === INTERNAL_API_SECRET || authHeader || apiKey) {
    return requireAuth(req, res, next);
  }
  req.user = null;
  next();
}

/**
 * Require admin role
 */
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && !req.isInternalEdge)) {
    return res.status(403).json({ success: false, status: 'error', error: 'Admin privileges required.', message: 'Admin privileges required' });
  }
  next();
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireAdmin,
  JWT_SECRET,
  INTERNAL_API_SECRET
};
