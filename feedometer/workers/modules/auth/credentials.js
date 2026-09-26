/**
 * workers/modules/auth/credentials.js — Registration, Password Login & Logout
 * Cloudflare D1 Relational Engine
 */
import { sha256Hex, generateRandomHex, hashPassword, verifyPassword } from '../../lib/crypto.js';
import { jsonResponse, errorResponse } from '../../lib/response.js';
import { getClientInfo, logAudit } from '../../lib/audit.js';
import { verifySessionToken } from '../../lib/session.js';
import { sendTransactionalEmail } from '../../services/email-service.js';
import { passwordResetEmail } from '../../services/email-templates.js';
import { emailVerificationEmail, welcomeEmail, passwordChangedEmail } from '../../services/email-templates.js';

export const SESSION_TTL_DAYS = 30;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function handleRegister(request, env) {
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const firstName = (body.first_name || body.name || '').trim();
  const lastName = (body.last_name || '').trim();

  if (!email || !email.includes('@') || !email.includes('.')) {
    return errorResponse('Valid email address is required', 400);
  }
  if (!password || password.length < 8) {
    return errorResponse('Password must be at least 8 characters long', 400);
  }

  try {
    // 1. Check if user already exists
    const existingUser = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();
    if (existingUser) {
      const existingPassword = await env.DB.prepare('SELECT user_id FROM user_passwords WHERE user_id = ?').bind(existingUser.id).first();
      if (existingPassword) {
        return errorResponse('An account with this email already exists. Please log in.', 409);
      } else {
        return errorResponse('An account with this email already exists via Google Sign-In. Please sign in with Google or set a password in Settings.', 409);
      }
    }

    const userId = `u_${generateRandomHex(12)}`;
    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const { ip, ua, device } = getClientInfo(request);

    // 2. Insert Core User
    await env.DB.prepare(`
      INSERT INTO users (id, email, email_verified, first_name, last_name, display_name, status, created_at, last_login)
      VALUES (?, ?, 0, ?, ?, ?, 'active', ?, ?)
    `).bind(userId, email, firstName, lastName, firstName || email.split('@')[0], now, now).run();

    // 3. Insert User Passwords
    await env.DB.prepare(`
      INSERT INTO user_passwords (user_id, password_hash, password_changed_at, failed_attempts, locked_until)
      VALUES (?, ?, ?, 0, NULL)
    `).bind(userId, passwordHash, now).run();

    // 4. Insert Default User Preferences
    await env.DB.prepare(`
      INSERT INTO user_preferences (user_id, theme, reading_mode, font_size, default_view, timezone, language, date_format, email_notifications, auto_mark_read, updated_at)
      VALUES (?, 'system', 'cards', 'medium', 'home', 'UTC', 'en', 'YYYY-MM-DD', 1, 0, ?)
    `).bind(userId, now).run();

    // 5. Generate Email Verification Token
    const verifyToken = generateRandomHex(32);
    const verifyHash = await sha256Hex(verifyToken);
    const verifyId = `ev_${generateRandomHex(12)}`;
    await env.DB.prepare(`
      INSERT INTO email_verifications (id, user_id, token_hash, expires_at, used, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).bind(verifyId, userId, verifyHash, now + 24 * 60 * 60 * 1000, now).run();

    // 6. Create Active Session
    const rawToken = generateRandomHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const sessionId = `sess_${generateRandomHex(12)}`;
    const expiresAt = now + SESSION_TTL_MS;

    await env.DB.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, device_name, created_at, expires_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(sessionId, userId, tokenHash, ip, ua, device, now, expiresAt, now).run();

    await logAudit(env, userId, 'REGISTRATION_SUCCESS', { method: 'password', ip }, request);

    const verifyUrl = (env.APP_PUBLIC_URL || env.PAGES_URL || 'https://feedometer-4vg.pages.dev') +
      '/shell.html?verify_email_token=' + encodeURIComponent(verifyToken);
    // Account creation remains successful even if the email provider is briefly unavailable.
    await sendTransactionalEmail(env, { to: email, ...emailVerificationEmail({ verifyUrl }) });

    return jsonResponse({
      status: 'success',
      token: rawToken,
      user: {
        id: userId,
        email,
        email_verified: 0,
        first_name: firstName,
        last_name: lastName,
        display_name: firstName || email.split('@')[0],
        avatar_url: '',
        dob: '',
        dob_locked: 0,
        created_at: now,
        plan: 'free'
      }
    }, 201);

  } catch (err) {
    console.error('Registration failed:', err.message);
    return errorResponse('Failed to create account: ' + err.message, 500);
  }
}

export async function handleVerifyEmail(request, env) {
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);
  const token = (new URL(request.url).searchParams.get('token') || '').trim();
  if (token.length < 16) return errorResponse('Valid verification token is required', 400);
  try {
    const tokenHash = await sha256Hex(token);
    const now = Date.now();
    const record = await env.DB.prepare(`SELECT ev.id, ev.user_id, ev.expires_at, ev.used, u.email, u.display_name, u.first_name FROM email_verifications ev JOIN users u ON u.id = ev.user_id WHERE ev.token_hash = ?`).bind(tokenHash).first();
    if (!record || record.used || record.expires_at < now) return errorResponse('This verification link is invalid or has expired.', 400);
    await env.DB.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').bind(record.id).run();
    await env.DB.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').bind(now, record.user_id).run();
    await sendTransactionalEmail(env, { to: record.email, ...welcomeEmail({ name: record.display_name || record.first_name || record.email.split('@')[0] }) });
    return jsonResponse({ status: 'success', message: 'Email address verified successfully.' });
  } catch (err) { return errorResponse('Failed to verify email: ' + err.message, 500); }
}

export async function handleLogin(request, env) {
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!email || !password) {
    return errorResponse('Email and password are required', 400);
  }

  try {
    const user = await env.DB.prepare(`
      SELECT * FROM users WHERE email = ?
    `).bind(email).first();

    if (!user || user.status !== 'active') {
      return errorResponse('Invalid email or password', 401);
    }

    const passRecord = await env.DB.prepare(`
      SELECT password_hash, failed_attempts, locked_until FROM user_passwords WHERE user_id = ?
    `).bind(user.id).first();

    if (!passRecord) {
      return errorResponse('This account was created via Google Sign-In. Please sign in with Google or use password recovery in Settings.', 400);
    }

    const now = Date.now();

    // Check brute-force lockout
    if (passRecord.locked_until && passRecord.locked_until > now) {
      const remainingMinutes = Math.ceil((passRecord.locked_until - now) / 60000);
      return errorResponse(`Account is temporarily locked due to repeated failed logins. Please try again in ${remainingMinutes} minute(s).`, 423);
    }

    // Verify Password Hash
    const isValid = await verifyPassword(password, passRecord.password_hash);
    if (!isValid) {
      const attempts = (passRecord.failed_attempts || 0) + 1;
      let lockedUntil = null;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = now + LOCKOUT_DURATION_MS;
      }
      await env.DB.prepare('UPDATE user_passwords SET failed_attempts = ?, locked_until = ? WHERE user_id = ?')
        .bind(attempts, lockedUntil, user.id).run();
      await logAudit(env, user.id, 'LOGIN_FAILED', { attempts, locked: Boolean(lockedUntil) }, request);
      return errorResponse('Invalid email or password', 401);
    }

    // Reset failed attempts upon successful login
    await env.DB.prepare('UPDATE user_passwords SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?').bind(user.id).run();
    await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id).run();

    // Create session
    const { ip, ua, device } = getClientInfo(request);
    const rawToken = generateRandomHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const sessionId = `sess_${generateRandomHex(12)}`;
    const expiresAt = now + SESSION_TTL_MS;

    await env.DB.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, device_name, created_at, expires_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(sessionId, user.id, tokenHash, ip, ua, device, now, expiresAt, now).run();

    await logAudit(env, user.id, 'LOGIN_SUCCESS', { method: 'password', ip, device }, request);

    return jsonResponse({
      status: 'success',
      token: rawToken,
      user: {
        id: user.id,
        email: user.email,
        email_verified: user.email_verified,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        display_name: user.display_name || user.first_name || user.email.split('@')[0],
        dob: user.dob || '',
        dob_locked: user.dob_locked || 0,
        avatar_url: user.avatar_url || '',
        created_at: user.created_at,
        plan: user.plan || 'free'
      }
    });

  } catch (err) {
    console.error('Login failed:', err.message);
    return errorResponse('Login failed: ' + err.message, 500);
  }
}

export async function handleLogout(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) {
    return jsonResponse({ status: 'success', message: 'Logged out' });
  }

  try {
    await env.DB.prepare('DELETE FROM user_sessions WHERE id = ?').bind(session.sessionId).run();
    await logAudit(env, session.userId, 'LOGOUT', {}, request);
    return jsonResponse({ status: 'success', message: 'Logged out successfully' });
  } catch (e) {
    return errorResponse('Failed to delete session', 500);
  }
}

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function handleForgotPassword(request, env) {
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) {
    return errorResponse('Valid email address is required', 400);
  }

  const now = Date.now();
  const genericSuccess = {
    status: 'success',
    message: 'If an account exists with this email address, password reset instructions have been generated.'
  };

  try {
    const user = await env.DB.prepare('SELECT id, email, status FROM users WHERE email = ?').bind(email).first();
    if (!user || user.status !== 'active') {
      return jsonResponse(genericSuccess, 200);
    }

    const passRecord = await env.DB.prepare('SELECT user_id FROM user_passwords WHERE user_id = ?').bind(user.id).first();
    if (!passRecord) {
      return jsonResponse({
        status: 'success',
        message: 'This account is registered via Google Sign-In. Please sign in using Google.'
      }, 200);
    }

    // Invalidate any existing unused reset tokens for this user
    await env.DB.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0').bind(user.id).run();

    // Generate 32-byte hex token
    const rawResetToken = generateRandomHex(32);
    const tokenHash = await sha256Hex(rawResetToken);
    const resetId = `prt_${generateRandomHex(12)}`;
    const expiresAt = now + RESET_TOKEN_TTL_MS;

    await env.DB.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).bind(resetId, user.id, tokenHash, expiresAt, now).run();

    await logAudit(env, user.id, 'PASSWORD_RESET_REQUESTED', { email }, request);

    // Password-reset links must lead to the active Pages shell, never the API
    // Worker or the retired legacy Pages deployment. APP_PUBLIC_URL is a
    // non-secret Worker variable so only environment configuration changes at
    // go-live; the authentication logic remains identical.
    const resetUrl = (env.APP_PUBLIC_URL || env.PAGES_URL || 'https://feedometer-4vg.pages.dev') +
      '/shell.html?reset_token=' + encodeURIComponent(rawResetToken);

    const delivery = await sendTransactionalEmail(
      env,
      { to: user.email, ...passwordResetEmail({ resetUrl, expiresInMinutes: 60 }) }
    );
    const mailed = delivery.ok;

    const payload = {
      status: 'success',
      message: mailed
        ? 'If an account exists with this email address, password reset instructions have been sent.'
        : genericSuccess.message
    };
    if (env.ENVIRONMENT !== 'production' || env.RETURN_RESET_TOKEN === '1') {
      payload.reset_token = rawResetToken;
      payload.expires_at = expiresAt;
    }
    return jsonResponse(payload, 200);

  } catch (err) {
    console.error('Forgot password failed:', err.message);
    return errorResponse('Failed to process password reset request: ' + err.message, 500);
  }
}

export async function handleVerifyResetToken(request, env) {
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);

  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();

  if (!token || token.length < 16) {
    return errorResponse('Valid reset token is required', 400);
  }

  try {
    const tokenHash = await sha256Hex(token);
    const now = Date.now();

    const record = await env.DB.prepare(`
      SELECT prt.id, prt.user_id, prt.expires_at, prt.used, u.email
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE prt.token_hash = ?
    `).bind(tokenHash).first();

    if (!record) {
      return errorResponse('Invalid password reset token.', 404);
    }
    if (record.used === 1) {
      return errorResponse('This password reset link has already been used. Please request a new one.', 400);
    }
    if (record.expires_at < now) {
      return errorResponse('This password reset link has expired. Please request a new one.', 400);
    }

    const emailParts = record.email.split('@');
    const maskedName = emailParts[0].length <= 2 
      ? emailParts[0].charAt(0) + '*' 
      : emailParts[0].charAt(0) + '***' + emailParts[0].slice(-1);
    const maskedEmail = maskedName + '@' + emailParts[1];

    return jsonResponse({
      status: 'success',
      valid: true,
      email: maskedEmail
    });

  } catch (err) {
    console.error('Verify reset token failed:', err.message);
    return errorResponse('Failed to verify reset token: ' + err.message, 500);
  }
}

export async function handleResetPassword(request, env) {
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  const token = (body.token || '').trim();
  const newPassword = body.new_password || body.password || '';

  if (!token) {
    return errorResponse('Reset token is required', 400);
  }
  if (!newPassword || newPassword.length < 8) {
    return errorResponse('Password must be at least 8 characters long', 400);
  }

  try {
    const tokenHash = await sha256Hex(token);
    const now = Date.now();

    const record = await env.DB.prepare(`
      SELECT prt.id, prt.user_id, prt.expires_at, prt.used, u.email, u.email_verified, u.first_name, u.last_name, u.display_name, u.dob, u.dob_locked, u.avatar_url, u.created_at
      FROM password_reset_tokens prt
      JOIN users u ON prt.user_id = u.id
      WHERE prt.token_hash = ?
    `).bind(tokenHash).first();

    if (!record) {
      return errorResponse('Invalid password reset token.', 404);
    }
    if (record.used === 1) {
      return errorResponse('This password reset link has already been used. Please request a new one.', 400);
    }
    if (record.expires_at < now) {
      return errorResponse('This password reset link has expired. Please request a new one.', 400);
    }

    const userId = record.user_id;
    const newPasswordHash = await hashPassword(newPassword);

    // 1. Update Password in user_passwords
    await env.DB.prepare(`
      UPDATE user_passwords
      SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL
      WHERE user_id = ?
    `).bind(newPasswordHash, now, userId).run();

    // 2. Mark token as used
    await env.DB.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').bind(record.id).run();

    // 3. Invalidate all prior sessions
    await env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run();

    // 4. Create fresh active session
    const { ip, ua, device } = getClientInfo(request);
    const rawSessionToken = generateRandomHex(32);
    const sessionTokenHash = await sha256Hex(rawSessionToken);
    const sessionId = `sess_${generateRandomHex(12)}`;
    const expiresAt = now + SESSION_TTL_MS;

    await env.DB.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, device_name, created_at, expires_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(sessionId, userId, sessionTokenHash, ip, ua, device, now, expiresAt, now).run();

    await logAudit(env, userId, 'PASSWORD_RESET_SUCCESS', { ip, device }, request);
    await sendTransactionalEmail(env, { to: record.email, ...passwordChangedEmail() });

    return jsonResponse({
      status: 'success',
      message: 'Password has been reset successfully.',
      token: rawSessionToken,
      user: {
        id: userId,
        email: record.email,
        email_verified: record.email_verified,
        first_name: record.first_name || '',
        last_name: record.last_name || '',
        display_name: record.display_name || record.first_name || record.email.split('@')[0],
        dob: record.dob || '',
        dob_locked: record.dob_locked || 0,
        avatar_url: record.avatar_url || '',
        created_at: record.created_at,
        plan: record.plan || 'free'
      }
    }, 200);

  } catch (err) {
    console.error('Reset password failed:', err.message);
    return errorResponse('Failed to reset password: ' + err.message, 500);
  }
}
