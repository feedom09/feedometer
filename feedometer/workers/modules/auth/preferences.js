/**
 * workers/modules/auth/preferences.js — User Profiles, Password Change, Preferences & Account Lifecycle
 * Cloudflare D1 Relational Engine
 */
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { jsonResponse, errorResponse } from '../../lib/response.js';
import { logAudit } from '../../lib/audit.js';
import { verifySessionToken } from '../../lib/session.js';
import { sendTransactionalEmail } from '../../services/email-service.js';
import { passwordChangedEmail } from '../../services/email-templates.js';

export async function handleMe(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) {
    return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  }

  try {
    const providers = await env.DB.prepare(`
      SELECT provider, provider_email, created_at FROM user_auth_providers WHERE user_id = ?
    `).bind(session.userId).all();

    const prefs = await env.DB.prepare(`
      SELECT theme, reading_mode, font_size, default_view, timezone, language, date_format, email_notifications, auto_mark_read
      FROM user_preferences WHERE user_id = ?
    `).bind(session.userId).first();

    const hasPassword = Boolean(await env.DB.prepare('SELECT user_id FROM user_passwords WHERE user_id = ?').bind(session.userId).first());

    return jsonResponse({
      status: 'success',
      user: session.user,
      providers: providers.results || [],
      preferences: prefs || {},
      has_password: hasPassword
    });
  } catch (e) {
    return errorResponse('Failed to retrieve user profile: ' + e.message, 500);
  }
}

export async function handleProfileUpdate(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  try {
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.userId).first();
    if (!user) return errorResponse('User not found', 404);

    const firstName = body.first_name !== undefined ? body.first_name.trim() : user.first_name;
    const lastName = body.last_name !== undefined ? body.last_name.trim() : user.last_name;
    const displayName = body.display_name !== undefined ? body.display_name.trim() : user.display_name;
    const avatarUrl = body.avatar_url !== undefined ? body.avatar_url.trim() : user.avatar_url;
    
    let dob = user.dob;
    let dobLocked = user.dob_locked || 0;

    // Strict DOB Rule
    if (body.dob && body.dob !== user.dob) {
      if (user.dob_locked === 1) {
        return errorResponse('Date of Birth has already been verified and locked. Please contact support.', 403);
      }
      dob = body.dob.trim();
      dobLocked = 1;
    }

    const now = Date.now();
    await env.DB.prepare(`
      UPDATE users
      SET first_name = ?, last_name = ?, display_name = ?, dob = ?, dob_locked = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).bind(firstName, lastName, displayName, dob, dobLocked, avatarUrl, now, session.userId).run();

    await logAudit(env, session.userId, 'PROFILE_UPDATED', { firstName, lastName, displayName, dobLocked }, request);

    return jsonResponse({
      status: 'success',
      user: {
        id: user.id,
        email: user.email,
        email_verified: user.email_verified,
        first_name: firstName,
        last_name: lastName,
        display_name: displayName,
        dob,
        dob_locked: dobLocked,
        avatar_url: avatarUrl,
        created_at: user.created_at,
        plan: user.plan || 'free'
      }
    });

  } catch (err) {
    return errorResponse('Failed to update profile: ' + err.message, 500);
  }
}

export async function handlePasswordChange(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  const currentPassword = body.current_password || '';
  const newPassword = body.new_password || '';

  if (!newPassword || newPassword.length < 8) {
    return errorResponse('New password must be at least 8 characters long', 400);
  }

  try {
    const passRecord = await env.DB.prepare('SELECT password_hash FROM user_passwords WHERE user_id = ?').bind(session.userId).first();
    const now = Date.now();
    const newHash = await hashPassword(newPassword);

    if (passRecord) {
      // User has existing password -> verify current_password
      if (!currentPassword) {
        return errorResponse('Current password is required', 400);
      }
      const isValid = await verifyPassword(currentPassword, passRecord.password_hash);
      if (!isValid) {
        return errorResponse('Current password is incorrect', 403);
      }

      const updateResult = await env.DB.prepare('UPDATE user_passwords SET password_hash = ?, password_changed_at = ?, failed_attempts = 0 WHERE user_id = ?')
        .bind(newHash, now, session.userId).run();
      // Never acknowledge a password change unless D1 confirms exactly one
      // credential record was written. This prevents a false-success UI.
      if (Number(updateResult.meta?.changes || 0) !== 1) {
        throw new Error('Password credential could not be updated');
      }
    } else {
      // User is OAuth-only setting password for first time
      await env.DB.prepare('INSERT INTO user_passwords (user_id, password_hash, password_changed_at, failed_attempts, locked_until) VALUES (?, ?, ?, 0, NULL)')
        .bind(session.userId, newHash, now).run();
    }

    // Invalidate all OTHER active sessions
    await env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ? AND id != ?').bind(session.userId, session.sessionId).run();
    await logAudit(env, session.userId, 'PASSWORD_CHANGED', { other_sessions_revoked: true }, request);
    // A completed password update must not masquerade as a completed email
    // delivery. Return the provider outcome so the UI can warn the user while
    // preserving the security-critical password change.
    const delivery = await sendTransactionalEmail(env, { to: session.email, ...passwordChangedEmail() });

    return jsonResponse({
      status: 'success',
      message: delivery.ok
        ? 'Password updated successfully. All other active sessions have been revoked and a security email was sent.'
        : 'Password updated successfully and other active sessions were revoked, but the security email could not be sent.',
      notification: {
        sent: Boolean(delivery.ok),
        code: delivery.ok ? null : (delivery.code || 'EMAIL_DELIVERY_FAILED')
      }
    });

  } catch (err) {
    return errorResponse('Failed to change password: ' + err.message, 500);
  }
}

export async function handleGetPreferences(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  try {
    const prefs = await env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(session.userId).first();
    return jsonResponse({ status: 'success', preferences: prefs || {} });
  } catch (err) {
    return errorResponse('Failed to load preferences', 500);
  }
}

export async function handleUpdatePreferences(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  try {
    const now = Date.now();
    const existing = await env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(session.userId).first() || {};

    const theme = body.theme || existing.theme || 'system';
    const readingMode = body.reading_mode || existing.reading_mode || 'cards';
    const fontSize = body.font_size || existing.font_size || 'medium';
    const defaultView = body.default_view || existing.default_view || 'home';
    const timezone = body.timezone || existing.timezone || 'UTC';
    const language = body.language || existing.language || 'en';
    const dateFormat = body.date_format || existing.date_format || 'YYYY-MM-DD';
    const emailNotifications = body.email_notifications !== undefined ? body.email_notifications : (existing.email_notifications ?? 1);
    const autoMarkRead = body.auto_mark_read !== undefined ? body.auto_mark_read : (existing.auto_mark_read ?? 0);

    await env.DB.prepare(`
      INSERT INTO user_preferences (user_id, theme, reading_mode, font_size, default_view, timezone, language, date_format, email_notifications, auto_mark_read, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        theme = excluded.theme,
        reading_mode = excluded.reading_mode,
        font_size = excluded.font_size,
        default_view = excluded.default_view,
        timezone = excluded.timezone,
        language = excluded.language,
        date_format = excluded.date_format,
        email_notifications = excluded.email_notifications,
        auto_mark_read = excluded.auto_mark_read,
        updated_at = excluded.updated_at
    `).bind(session.userId, theme, readingMode, fontSize, defaultView, timezone, language, dateFormat, emailNotifications, autoMarkRead, now).run();

    return jsonResponse({
      status: 'success',
      preferences: {
        theme, reading_mode: readingMode, font_size: fontSize, default_view: defaultView,
        timezone, language, date_format: dateFormat, email_notifications: emailNotifications, auto_mark_read: autoMarkRead
      }
    });

  } catch (err) {
    return errorResponse('Failed to update preferences: ' + err.message, 500);
  }
}

export async function handleDeleteAccount(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401);
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }

  const confirmEmail = (body.email || '').trim().toLowerCase();
  if (!confirmEmail || confirmEmail !== String(session.email || '').toLowerCase()) {
    return errorResponse('Type your account email to confirm deletion', 400);
  }

  const userId = session.userId;
  try {
    await logAudit(env, userId, 'ACCOUNT_DELETE_REQUESTED', { email: confirmEmail }, request);

    const cleanup = [
      'DELETE FROM user_sessions WHERE user_id = ?',
      'DELETE FROM user_passwords WHERE user_id = ?',
      'DELETE FROM user_auth_providers WHERE user_id = ?',
      'DELETE FROM user_preferences WHERE user_id = ?',
      'DELETE FROM email_verifications WHERE user_id = ?',
      'DELETE FROM password_reset_tokens WHERE user_id = ?',
      'DELETE FROM user_feed_assignments WHERE user_id = ?',
      'DELETE FROM user_feeds WHERE user_id = ?',
      'DELETE FROM folders WHERE user_id = ?',
      'DELETE FROM starred_articles WHERE user_id = ?',
      'DELETE FROM saved_articles WHERE user_id = ?',
      'DELETE FROM read_history WHERE user_id = ?'
    ];
    for (const sql of cleanup) {
      try {
        await env.DB.prepare(sql).bind(userId).run();
      } catch (e) {}
    }
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

    return jsonResponse({ status: 'success', message: 'Account deleted' });
  } catch (err) {
    return errorResponse('Failed to delete account: ' + err.message, 500);
  }
}
