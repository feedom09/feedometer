const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const AuthService = require('../services/AuthService');
const UserService = require('../services/UserService');
const EmailJobService = require('../services/EmailJobService');
const AuditService = require('../services/AuditService');
const { requireAuth } = require('../middleware/authMiddleware');
const { query, sql } = require('../config/db');

// Helper: Verify Google Access Token
async function fetchGoogleProfile(accessToken, credential) {
  if (accessToken) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      throw new Error('Google OAuth token verification failed.');
    }
    const data = await res.json();
    return {
      sub: data.sub,
      email: data.email,
      name: data.name || data.email.split('@')[0],
      picture: data.picture || ''
    };
  }

  if (credential) {
    const parts = credential.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        picture: payload.picture || ''
      };
    }
  }

  throw new Error('Missing Google access token or credential.');
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, plan } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: 'error', success: false, message: 'Email and password are required.' });
    }
    const result = await AuthService.register({ email, password, name, plan });
    AuditService.log({ userId: result.user.id, action: 'user.register', ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    
    // Dispatch verification email in background
    EmailJobService.sendVerificationEmail(result.user.id, email).catch(err => {
      console.error('[Verification Email Dispatch Error]', err.message);
    });

    res.json({
      status: 'success',
      success: true,
      user: result.user,
      token: result.token
    });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: 'error', success: false, message: 'Email and password are required.' });
    }
    const result = await AuthService.login({
      email,
      password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    AuditService.log({ userId: result.user.id, action: 'user.login', ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    res.json({
      status: 'success',
      success: true,
      user: result.user,
      token: result.token
    });
  } catch (err) {
    res.status(401).json({ status: 'error', success: false, message: err.message });
  }
});

// Google OAuth Login / Token Exchange
router.post('/google', async (req, res) => {
  try {
    const { access_token, credential, providerUserId, email, name, avatarUrl } = req.body;
    
    let googleUser;
    if (access_token || credential) {
      googleUser = await fetchGoogleProfile(access_token, credential);
    } else if (providerUserId && email) {
      googleUser = { sub: providerUserId, email, name, picture: avatarUrl };
    } else {
      return res.status(400).json({ status: 'error', success: false, message: 'Google access token is required.' });
    }

    const result = await AuthService.oauthLogin({
      provider: 'google',
      providerUserId: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.picture
    });

    AuditService.log({
      userId: result.user.id,
      action: 'user.google_login',
      details: { email: googleUser.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      status: 'success',
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.display_name || result.user.name,
        display_name: result.user.display_name || result.user.name,
        avatar_url: result.user.avatar_url,
        picture: result.user.avatar_url,
        plan: result.user.plan || 'free'
      },
      token: result.token
    });
  } catch (err) {
    console.error('[Google OAuth Error]', err);
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// OAuth generic endpoint alias
router.post('/oauth', async (req, res) => {
  try {
    const { provider = 'google', providerUserId, email, name, avatarUrl } = req.body;
    if (!providerUserId || !email) {
      return res.status(400).json({ status: 'error', success: false, message: 'Provider user ID and email are required.' });
    }
    const result = await AuthService.oauthLogin({ provider, providerUserId, email, name, avatarUrl });
    res.json({
      status: 'success',
      success: true,
      user: result.user,
      token: result.token
    });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Current User Session (/api/auth/me)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await UserService.getProfile(req.user.id);
    const providers = await query(`SELECT provider, provider_email, created_at FROM dbo.user_auth_providers WHERE user_id = @userId`, {
      userId: { type: sql.NVarChar(64), value: req.user.id }
    });
    const pass = await query(`SELECT user_id FROM dbo.user_passwords WHERE user_id = @userId`, {
      userId: { type: sql.NVarChar(64), value: req.user.id }
    });

    res.json({
      status: 'success',
      success: true,
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.display_name,
        display_name: profile.display_name,
        first_name: profile.first_name,
        last_name: profile.last_name,
        dob: profile.dob,
        dob_locked: profile.dob_locked,
        avatar_url: profile.avatar_url,
        picture: profile.avatar_url,
        plan: profile.plan,
        email_verified: profile.email_verified === 1,
        feed_count: profile.feed_count,
        starred_count: profile.starred_count,
        saved_count: profile.saved_count
      },
      preferences: {
        theme: profile.theme,
        reading_mode: profile.reading_mode,
        font_size: profile.font_size,
        default_view: profile.default_view,
        timezone: profile.timezone,
        language: profile.language,
        auto_mark_read: profile.auto_mark_read === 1,
        email_notifications: profile.email_notifications === 1
      },
      providers: providers.recordset || [],
      has_password: Boolean(pass.recordset && pass.recordset.length > 0)
    });
  } catch (err) {
    res.status(404).json({ status: 'error', success: false, message: err.message });
  }
});

// Update Profile
router.post('/profile', requireAuth, async (req, res) => {
  try {
    const updated = await UserService.updateProfile(req.user.id, req.body);
    res.json({
      status: 'success',
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.display_name,
        display_name: updated.display_name,
        first_name: updated.first_name,
        last_name: updated.last_name,
        dob: updated.dob,
        dob_locked: updated.dob_locked,
        avatar_url: updated.avatar_url,
        picture: updated.avatar_url,
        plan: updated.plan
      }
    });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Change Password (from Settings Modal)
router.post('/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password) {
      return res.status(400).json({ status: 'error', success: false, message: 'New password is required.' });
    }

    const passRes = await query(`SELECT password_hash FROM dbo.user_passwords WHERE user_id = @userId`, {
      userId: { type: sql.NVarChar(64), value: req.user.id }
    });

    if (passRes.recordset && passRes.recordset.length > 0) {
      const currentHash = passRes.recordset[0].password_hash;
      if (currentHash && current_password) {
        const match = await bcrypt.compare(current_password, currentHash);
        if (!match) {
          return res.status(400).json({ status: 'error', success: false, message: 'Current password is incorrect.' });
        }
      }
    }

    const newHash = await bcrypt.hash(new_password, 10);
    const now = Date.now();

    await query(`
      IF EXISTS (SELECT 1 FROM dbo.user_passwords WHERE user_id = @userId)
      BEGIN
        UPDATE dbo.user_passwords SET password_hash = @hash, password_changed_at = @now, failed_attempts = 0 WHERE user_id = @userId
      END
      ELSE
      BEGIN
        INSERT INTO dbo.user_passwords (user_id, password_hash, password_changed_at, failed_attempts) VALUES (@userId, @hash, @now, 0)
      END;
      UPDATE dbo.users SET updated_at = @now WHERE id = @userId;
    `, {
      userId: { type: sql.NVarChar(64), value: req.user.id },
      hash: { type: sql.NVarChar(255), value: newHash },
      now: { type: sql.BigInt, value: now }
    });

    AuditService.log({ userId: req.user.id, action: 'user.change_password', ipAddress: req.ip, userAgent: req.headers['user-agent'] });

    // Send confirmation email
    let emailSent = false;
    try {
      await EmailJobService.sendPasswordChangedEmail(req.user.email, req.user.display_name || req.user.name);
      emailSent = true;
    } catch (e) {
      console.warn('[Password Change Email Warning]', e.message);
    }

    res.json({
      status: 'success',
      success: true,
      message: 'Password updated successfully.',
      notification: { sent: emailSent, code: emailSent ? 'OK' : 'EMAIL_SKIPPED' }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// List User Sessions (for Settings Modal)
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const currentToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    const currentHash = currentToken ? crypto.createHash('sha256').update(currentToken).digest('hex') : '';

    const sessionsRes = await query(`
      SELECT id, ip_address, user_agent, device_name, created_at, last_seen, token_hash
      FROM dbo.user_sessions
      WHERE user_id = @userId
      ORDER BY last_seen DESC
    `, {
      userId: { type: sql.NVarChar(64), value: req.user.id }
    });

    const sessions = (sessionsRes.recordset || []).map(s => ({
      id: s.id,
      ip_address: s.ip_address,
      user_agent: s.user_agent,
      device_name: s.device_name || s.user_agent,
      created_at: s.created_at,
      last_seen: s.last_seen,
      is_current: Boolean(currentHash && s.token_hash === currentHash)
    }));

    res.json({ status: 'success', success: true, sessions });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Revoke a specific session
router.delete('/sessions/other', requireAuth, async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const currentToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    const currentHash = currentToken ? crypto.createHash('sha256').update(currentToken).digest('hex') : '';

    await query(`
      DELETE FROM dbo.user_sessions WHERE user_id = @userId AND token_hash != @currentHash
    `, {
      userId: { type: sql.NVarChar(64), value: req.user.id },
      currentHash: { type: sql.NVarChar(64), value: currentHash }
    });

    res.json({ status: 'success', success: true, message: 'All other sessions revoked.' });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    await query(`DELETE FROM dbo.user_sessions WHERE id = @id AND user_id = @userId`, {
      id: { type: sql.NVarChar(64), value: sessionId },
      userId: { type: sql.NVarChar(64), value: req.user.id }
    });
    res.json({ status: 'success', success: true, message: 'Session revoked.' });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// User Preferences (GET / POST)
router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const profile = await UserService.getProfile(req.user.id);
    res.json({
      status: 'success',
      success: true,
      preferences: {
        theme: profile.theme,
        reading_mode: profile.reading_mode,
        font_size: profile.font_size,
        default_view: profile.default_view,
        timezone: profile.timezone,
        language: profile.language,
        auto_mark_read: profile.auto_mark_read === 1,
        email_notifications: profile.email_notifications === 1
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

router.post('/preferences', requireAuth, async (req, res) => {
  try {
    await UserService.updatePreferences(req.user.id, req.body);
    const profile = await UserService.getProfile(req.user.id);
    res.json({
      status: 'success',
      success: true,
      preferences: {
        theme: profile.theme,
        reading_mode: profile.reading_mode,
        font_size: profile.font_size,
        default_view: profile.default_view,
        timezone: profile.timezone,
        language: profile.language,
        auto_mark_read: profile.auto_mark_read === 1,
        email_notifications: profile.email_notifications === 1
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Delete Account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(400).json({ status: 'error', success: false, message: 'Confirmation email does not match.' });
    }
    const now = Date.now();
    await query(`
      DELETE FROM dbo.user_sessions WHERE user_id = @userId;
      DELETE FROM dbo.user_auth_providers WHERE user_id = @userId;
      DELETE FROM dbo.user_preferences WHERE user_id = @userId;
      DELETE FROM dbo.user_passwords WHERE user_id = @userId;
      DELETE FROM dbo.user_feeds WHERE user_id = @userId;
      DELETE FROM dbo.starred_articles WHERE user_id = @userId;
      DELETE FROM dbo.saved_articles WHERE user_id = @userId;
      DELETE FROM dbo.read_history WHERE user_id = @userId;
      DELETE FROM dbo.folders WHERE user_id = @userId;
      DELETE FROM dbo.user_alerts WHERE user_id = @userId;
      DELETE FROM dbo.user_webhooks WHERE user_id = @userId;
      UPDATE dbo.users SET status = 'deleted', deleted_at = @now WHERE id = @userId;
    `, {
      userId: { type: sql.NVarChar(64), value: req.user.id },
      now: { type: sql.BigInt, value: now }
    });

    AuditService.log({ userId: req.user.id, action: 'user.delete_account', ipAddress: req.ip, userAgent: req.headers['user-agent'] });

    res.json({ status: 'success', success: true, message: 'Account deleted successfully.' });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ status: 'error', success: false, message: 'Email is required.' });
    const result = await EmailJobService.sendPasswordResetEmail(email);
    res.json({ status: 'success', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Verify Email Handler (supports both GET and POST)
async function handleVerifyEmail(req, res) {
  try {
    const token = (req.query.token || req.body.token || '').trim();
    if (!token) {
      return res.status(400).json({ status: 'error', success: false, message: 'Verification token is required.' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = Date.now();

    const check = await query(`
      SELECT id, user_id, expires_at, used
      FROM dbo.email_verifications
      WHERE token_hash = @hash
    `, {
      hash: { type: sql.NVarChar(64), value: tokenHash }
    });

    if (!check.recordset || check.recordset.length === 0) {
      return res.status(400).json({ status: 'error', success: false, message: 'Invalid verification link.' });
    }

    const ev = check.recordset[0];
    if (ev.used === 1) {
      return res.json({ status: 'success', success: true, message: 'Email has already been verified. You can sign in.' });
    }

    if (Number(ev.expires_at) < now) {
      return res.status(400).json({ status: 'error', success: false, message: 'This verification link has expired.' });
    }

    // Mark verified in database
    await query(`
      UPDATE dbo.email_verifications SET used = 1 WHERE id = @id;
      UPDATE dbo.users SET email_verified = 1, updated_at = @now WHERE id = @userId;
    `, {
      id: { type: sql.NVarChar(64), value: ev.id },
      userId: { type: sql.NVarChar(64), value: ev.user_id },
      now: { type: sql.BigInt, value: now }
    });

    AuditService.log({ userId: ev.user_id, action: 'user.verify_email', ipAddress: req.ip, userAgent: req.headers['user-agent'] });

    // Send Welcome Email
    const uRes = await query(`SELECT email, display_name FROM dbo.users WHERE id = @userId`, {
      userId: { type: sql.NVarChar(64), value: ev.user_id }
    });
    if (uRes.recordset && uRes.recordset.length > 0) {
      const verifiedUser = uRes.recordset[0];
      EmailJobService.sendWelcomeEmail(verifiedUser.email, verifiedUser.display_name).catch(err => {
        console.error('[Welcome Email Dispatch Error]', err.message);
      });
    }

    res.json({ status: 'success', success: true, message: 'Email verified successfully! You can now sign in.' });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
}

router.get('/verify-email', handleVerifyEmail);
router.post('/verify-email', handleVerifyEmail);

// Verify Reset Token (GET)
router.get('/reset-password', async (req, res) => {
  try {
    const token = (req.query.token || '').trim();
    if (!token) return res.status(400).json({ status: 'error', success: false, message: 'Reset token is required.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = Date.now();

    const check = await query(`
      SELECT id, user_id, expires_at, used
      FROM dbo.password_reset_tokens
      WHERE token_hash = @hash
    `, {
      hash: { type: sql.NVarChar(64), value: tokenHash }
    });

    if (!check.recordset || check.recordset.length === 0 || check.recordset[0].used === 1 || Number(check.recordset[0].expires_at) < now) {
      return res.status(400).json({ status: 'error', success: false, message: 'Invalid or expired reset token.' });
    }

    res.json({ status: 'success', success: true, message: 'Reset token is valid.' });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Reset Password with Token (POST)
router.post('/reset-password', async (req, res) => {
  try {
    const token = (req.body.token || req.query.token || '').trim();
    const password = req.body.password || req.body.new_password;
    if (!token || !password) {
      return res.status(400).json({ status: 'error', success: false, message: 'Token and new password are required.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = Date.now();

    const check = await query(`
      SELECT id, user_id, expires_at, used
      FROM dbo.password_reset_tokens
      WHERE token_hash = @hash
    `, {
      hash: { type: sql.NVarChar(64), value: tokenHash }
    });

    if (!check.recordset || check.recordset.length === 0) {
      return res.status(400).json({ status: 'error', success: false, message: 'Invalid password reset link.' });
    }

    const prt = check.recordset[0];
    if (prt.used === 1) {
      return res.status(400).json({ status: 'error', success: false, message: 'This password reset link has already been used.' });
    }

    if (Number(prt.expires_at) < now) {
      return res.status(400).json({ status: 'error', success: false, message: 'This password reset link has expired.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Update password in database
    await query(`
      UPDATE dbo.password_reset_tokens SET used = 1 WHERE id = @id;
      UPDATE dbo.user_passwords SET password_hash = @hash, password_changed_at = @now, failed_attempts = 0 WHERE user_id = @userId;
      UPDATE dbo.users SET updated_at = @now WHERE id = @userId;
    `, {
      id: { type: sql.NVarChar(64), value: prt.id },
      userId: { type: sql.NVarChar(64), value: prt.user_id },
      hash: { type: sql.NVarChar(255), value: passwordHash },
      now: { type: sql.BigInt, value: now }
    });

    AuditService.log({ userId: prt.user_id, action: 'user.reset_password', ipAddress: req.ip, userAgent: req.headers['user-agent'] });

    // Send Password Changed Confirmation Email
    const uRes = await query(`SELECT email, display_name FROM dbo.users WHERE id = @userId`, {
      userId: { type: sql.NVarChar(64), value: prt.user_id }
    });
    if (uRes.recordset && uRes.recordset.length > 0) {
      const resetUser = uRes.recordset[0];
      EmailJobService.sendPasswordChangedEmail(resetUser.email, resetUser.display_name).catch(err => {
        console.error('[Password Changed Email Dispatch Error]', err.message);
      });
    }

    res.json({ status: 'success', success: true, message: 'Password reset successfully. You can now sign in with your new password.' });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    await AuthService.logout(token);
    res.json({ status: 'success', success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

module.exports = router;
