/**
 * FeedOmeter 2.1 — AuthService
 * Domain Service for Authentication, Sessions, Password Security & OAuth
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, sql } = require('../config/db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

class AuthService {
  /**
   * Register a new user with email and password
   */
  async register({ email, password, name = '', plan = 'free' }) {
    const cleanEmail = email.trim().toLowerCase();
    
    // Check if user already exists
    const existing = await query(`
      SELECT id, status FROM dbo.users WHERE email = @email
    `, { email: { type: sql.NVarChar(255), value: cleanEmail } });

    if (existing.recordset && existing.recordset.length > 0) {
      throw new Error('User already exists with this email address.');
    }

    const userId = 'usr_' + crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);
    const now = Date.now();
    const displayName = name.trim() || cleanEmail.split('@')[0];

    // Insert user
    await query(`
      INSERT INTO dbo.users (id, email, email_verified, display_name, status, [plan], created_at, updated_at, last_login)
      VALUES (@id, @email, 0, @displayName, 'active', @plan, @now, @now, @now)
    `, {
      id: { type: sql.NVarChar(64), value: userId },
      email: { type: sql.NVarChar(255), value: cleanEmail },
      displayName: { type: sql.NVarChar(150), value: displayName },
      plan: { type: sql.NVarChar(20), value: plan },
      now: { type: sql.BigInt, value: now }
    });

    // Insert password
    await query(`
      INSERT INTO dbo.user_passwords (user_id, password_hash, password_changed_at, failed_attempts)
      VALUES (@userId, @hash, @now, 0)
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      hash: { type: sql.NVarChar(255), value: passwordHash },
      now: { type: sql.BigInt, value: now }
    });

    // Create default preferences
    await query(`
      INSERT INTO dbo.user_preferences (user_id, theme, reading_mode, font_size, default_view, timezone, language, date_format, email_notifications, auto_mark_read, updated_at)
      VALUES (@userId, 'system', 'cards', 'medium', 'home', 'UTC', 'en', 'YYYY-MM-DD', 1, 0, @now)
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      now: { type: sql.BigInt, value: now }
    });

    // Generate session token
    const token = this.generateToken(userId, cleanEmail, displayName, plan);
    await this.createSession(userId, token);

    return {
      success: true,
      user: { id: userId, email: cleanEmail, name: displayName, plan },
      token
    };
  }

  /**
   * Authenticate user with email and password
   */
  async login({ email, password, ipAddress = '', userAgent = '' }) {
    const cleanEmail = email.trim().toLowerCase();

    const result = await query(`
      SELECT u.id, u.email, u.display_name, u.[plan], u.status, u.email_verified, p.password_hash
      FROM dbo.users u
      LEFT JOIN dbo.user_passwords p ON u.id = p.user_id
      WHERE u.email = @email AND u.status != 'deleted'
    `, { email: { type: sql.NVarChar(255), value: cleanEmail } });

    if (!result.recordset || result.recordset.length === 0) {
      throw new Error('Invalid email or password.');
    }

    const user = result.recordset[0];

    if (user.status !== 'active') {
      throw new Error('This account has been suspended.');
    }

    if (!user.password_hash) {
      throw new Error('This account was created via Google Sign-In. Please log in with Google.');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      throw new Error('Invalid email or password.');
    }

    const now = Date.now();

    // Update last_login
    await query(`UPDATE dbo.users SET last_login = @now WHERE id = @id`, {
      id: { type: sql.NVarChar(64), value: user.id },
      now: { type: sql.BigInt, value: now }
    });

    const token = this.generateToken(user.id, user.email, user.display_name, user.plan);
    await this.createSession(user.id, token, ipAddress, userAgent);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        plan: user.plan,
        email_verified: user.email_verified === 1
      },
      token
    };
  }

  /**
   * OAuth Login or Registration (Google)
   */
  async oauthLogin({ provider = 'google', providerUserId, email, name = '', avatarUrl = '' }) {
    const cleanEmail = email.trim().toLowerCase();
    const now = Date.now();

    // Check if provider link exists
    const providerRes = await query(`
      SELECT u.id, u.email, u.display_name, u.[plan], u.status, u.avatar_url
      FROM dbo.user_auth_providers ap
      INNER JOIN dbo.users u ON ap.user_id = u.id
      WHERE ap.provider = @provider AND ap.provider_user_id = @pUserId AND u.status != 'deleted'
    `, {
      provider: { type: sql.NVarChar(30), value: provider },
      pUserId: { type: sql.NVarChar(255), value: providerUserId }
    });

    let user;

    if (providerRes.recordset && providerRes.recordset.length > 0) {
      user = providerRes.recordset[0];
    } else {
      // Check if user exists with same email
      const userRes = await query(`
        SELECT id, email, display_name, [plan], status, avatar_url
        FROM dbo.users
        WHERE email = @email AND status != 'deleted'
      `, { email: { type: sql.NVarChar(255), value: cleanEmail } });

      if (userRes.recordset && userRes.recordset.length > 0) {
        user = userRes.recordset[0];
        const authProvId = 'uap_' + crypto.randomBytes(12).toString('hex');
        await query(`
          INSERT INTO dbo.user_auth_providers (id, user_id, provider, provider_user_id, provider_email, created_at)
          VALUES (@id, @userId, @provider, @pUserId, @email, @now)
        `, {
          id: { type: sql.NVarChar(64), value: authProvId },
          userId: { type: sql.NVarChar(64), value: user.id },
          provider: { type: sql.NVarChar(30), value: provider },
          pUserId: { type: sql.NVarChar(255), value: providerUserId },
          email: { type: sql.NVarChar(255), value: cleanEmail },
          now: { type: sql.BigInt, value: now }
        });
      } else {
        // Create brand new user
        const newUserId = 'usr_' + crypto.randomBytes(16).toString('hex');
        const displayName = name.trim() || cleanEmail.split('@')[0];

        await query(`
          INSERT INTO dbo.users (id, email, email_verified, display_name, avatar_url, status, [plan], created_at, updated_at, last_login)
          VALUES (@id, @email, 1, @displayName, @avatarUrl, 'active', 'free', @now, @now, @now)
        `, {
          id: { type: sql.NVarChar(64), value: newUserId },
          email: { type: sql.NVarChar(255), value: cleanEmail },
          displayName: { type: sql.NVarChar(150), value: displayName },
          avatarUrl: { type: sql.NVarChar(500), value: avatarUrl || null },
          now: { type: sql.BigInt, value: now }
        });

        const authProvId = 'uap_' + crypto.randomBytes(12).toString('hex');
        await query(`
          INSERT INTO dbo.user_auth_providers (id, user_id, provider, provider_user_id, provider_email, created_at)
          VALUES (@id, @userId, @provider, @pUserId, @email, @now)
        `, {
          id: { type: sql.NVarChar(64), value: authProvId },
          userId: { type: sql.NVarChar(64), value: newUserId },
          provider: { type: sql.NVarChar(30), value: provider },
          pUserId: { type: sql.NVarChar(255), value: providerUserId },
          email: { type: sql.NVarChar(255), value: cleanEmail },
          now: { type: sql.BigInt, value: now }
        });

        // Preferences
        await query(`
          INSERT INTO dbo.user_preferences (user_id, theme, reading_mode, font_size, default_view, timezone, language, date_format, email_notifications, auto_mark_read, updated_at)
          VALUES (@userId, 'system', 'cards', 'medium', 'home', 'UTC', 'en', 'YYYY-MM-DD', 1, 0, @now)
        `, {
          userId: { type: sql.NVarChar(64), value: newUserId },
          now: { type: sql.BigInt, value: now }
        });

        user = { id: newUserId, email: cleanEmail, display_name: displayName, plan: 'free', status: 'active', avatar_url: avatarUrl };
      }
    }

    if (user.status !== 'active') {
      throw new Error('This account has been suspended.');
    }

    const token = this.generateToken(user.id, user.email, user.display_name, user.plan);
    await this.createSession(user.id, token);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        plan: user.plan,
        avatar_url: user.avatar_url
      },
      token
    };
  }

  /**
   * Helper: Generate signed JWT token
   */
  generateToken(userId, email, displayName, plan) {
    return jwt.sign(
      { id: userId, userId, email, displayName, plan },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
  }

  /**
   * Helper: Create database session record
   */
  async createSession(userId, token, ipAddress = null, userAgent = null) {
    const sessionId = 'us_' + crypto.randomBytes(12).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = Date.now();
    const expiresAt = now + (30 * 24 * 60 * 60 * 1000); // 30 days

    await query(`
      INSERT INTO dbo.user_sessions (id, user_id, token_hash, ip_address, user_agent, created_at, expires_at, last_seen)
      VALUES (@id, @userId, @hash, @ip, @ua, @now, @expiresAt, @now)
    `, {
      id: { type: sql.NVarChar(64), value: sessionId },
      userId: { type: sql.NVarChar(64), value: userId },
      hash: { type: sql.NVarChar(64), value: tokenHash },
      ip: { type: sql.NVarChar(45), value: ipAddress },
      ua: { type: sql.NVarChar(500), value: userAgent },
      now: { type: sql.BigInt, value: now },
      expiresAt: { type: sql.BigInt, value: expiresAt }
    });
  }

  /**
   * Log out and invalidate session
   */
  async logout(token) {
    if (!token) return { success: true };
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query(`DELETE FROM dbo.user_sessions WHERE token_hash = @hash`, {
      hash: { type: sql.NVarChar(64), value: tokenHash }
    });
    return { success: true };
  }
}

module.exports = new AuthService();
