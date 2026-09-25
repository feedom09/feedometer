/**
 * workers/modules/auth/google.js — Google OAuth Verification & Account Federation
 * Cloudflare D1 Relational Engine
 */
import { sha256Hex, generateRandomHex } from '../../lib/crypto.js';
import { jsonResponse, errorResponse } from '../../lib/response.js';
import { getClientInfo, logAudit } from '../../lib/audit.js';
import { SESSION_TTL_MS } from './credentials.js';

export async function verifyGoogleAccessToken(accessToken, env) {
  const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  if (!userinfoRes.ok) return null;
  const profile = await userinfoRes.json();
  if (!profile || !profile.sub || !profile.email) return null;

  const expectedAud = env.GOOGLE_CLIENT_ID || '';
  if (expectedAud) {
    try {
      const infoRes = await fetch(
        'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken)
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        const audience = info.aud || info.azp || '';
        if (audience && audience !== expectedAud) return null;
      }
    } catch (e) {}
  }

  const verified = profile.email_verified === true || profile.email_verified === 'true';
  if (!verified) return null;
  return profile;
}

export async function handleGoogleAuth(request, env) {
  if (!env.DB) return errorResponse('D1 Database binding missing', 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse('Invalid JSON body', 400);
  }

  const accessToken = (body.access_token || '').trim();
  if (!accessToken) {
    return errorResponse('Google access token is required', 400);
  }

  let googleProfile;
  try {
    googleProfile = await verifyGoogleAccessToken(accessToken, env);
  } catch (e) {
    return errorResponse('Google token verification failed', 401);
  }
  if (!googleProfile) {
    return errorResponse('Invalid or unverified Google account', 401);
  }

  const email = String(googleProfile.email || '').trim().toLowerCase();
  const name = String(googleProfile.name || '').trim();
  const picture = String(googleProfile.picture || '').trim();
  const sub = String(googleProfile.sub || '').trim();

  if (!email || !email.includes('@') || !sub) {
    return errorResponse('Google profile is missing email or subject ID', 400);
  }

  try {
    const now = Date.now();
    const { ip, ua, device } = getClientInfo(request);

    // 1. Check if Google provider is already linked
    const existingProvider = await env.DB.prepare(`
      SELECT user_id FROM user_auth_providers WHERE provider = 'google' AND provider_user_id = ?
    `).bind(sub).first();

    let userId;
    let user;

    if (existingProvider) {
      userId = existingProvider.user_id;
      user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
      const updatedAvatar = picture || (user ? user.avatar_url : '') || '';
      await env.DB.prepare('UPDATE users SET last_login = ?, email_verified = 1, avatar_url = COALESCE(NULLIF(?, \'\'), avatar_url) WHERE id = ?')
        .bind(now, updatedAvatar, userId).run();
      await env.DB.prepare('UPDATE user_auth_providers SET provider_metadata = ?, provider_email = ? WHERE provider = \'google\' AND provider_user_id = ?')
        .bind(JSON.stringify({ name, picture }), email, sub).run();
    } else {
      // 2. Check if user with this email already exists
      user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

      if (user) {
        userId = user.id;
        // Link Google to existing user
        const providerId = `prov_${generateRandomHex(12)}`;
        await env.DB.prepare(`
          INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, provider_email, provider_metadata, created_at)
          VALUES (?, ?, 'google', ?, ?, ?, ?)
        `).bind(providerId, userId, sub, email, JSON.stringify({ name, picture }), now).run();

        // Sync fresh Google photo
        const newAvatar = picture || user.avatar_url || '';
        await env.DB.prepare('UPDATE users SET last_login = ?, email_verified = 1, avatar_url = ? WHERE id = ?')
          .bind(now, newAvatar, userId).run();
        await logAudit(env, userId, 'PROVIDER_LINKED', { provider: 'google', email }, request);
      } else {
        // 3. New User creation via Google
        userId = `u_${generateRandomHex(12)}`;
        const firstName = name ? name.split(' ')[0] : email.split('@')[0];
        const lastName = name ? name.split(' ').slice(1).join(' ') : '';

        await env.DB.prepare(`
          INSERT INTO users (id, email, email_verified, first_name, last_name, display_name, dob_locked, avatar_url, status, created_at, last_login)
          VALUES (?, ?, 1, ?, ?, ?, 0, ?, 'active', ?, ?)
        `).bind(userId, email, firstName, lastName, name || firstName, picture, now, now).run();

        const providerId = `prov_${generateRandomHex(12)}`;
        await env.DB.prepare(`
          INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, provider_email, provider_metadata, created_at)
          VALUES (?, ?, 'google', ?, ?, ?, ?)
        `).bind(providerId, userId, sub, email, JSON.stringify({ name, picture }), now).run();

        // Default Preferences
        await env.DB.prepare(`
          INSERT INTO user_preferences (user_id, theme, reading_mode, font_size, default_view, timezone, language, date_format, email_notifications, auto_mark_read, updated_at)
          VALUES (?, 'system', 'cards', 'medium', 'home', 'UTC', 'en', 'YYYY-MM-DD', 1, 0, ?)
        `).bind(userId, now).run();

        await logAudit(env, userId, 'REGISTRATION_SUCCESS', { method: 'google', email }, request);
      }
    }

    // Re-fetch user profile for accuracy
    user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

    // 4. Create Active Session
    const rawToken = generateRandomHex(32);
    const tokenHash = await sha256Hex(rawToken);
    const sessionId = `sess_${generateRandomHex(12)}`;
    const expiresAt = now + SESSION_TTL_MS;

    await env.DB.prepare(`
      INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, device_name, created_at, expires_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(sessionId, userId, tokenHash, ip, ua, device, now, expiresAt, now).run();

    await logAudit(env, userId, 'LOGIN_SUCCESS', { method: 'google', ip, device }, request);

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
        avatar_url: user.avatar_url || picture || '',
        picture: user.avatar_url || picture || '',
        created_at: user.created_at,
        plan: user.plan || 'free'
      }
    });

  } catch (err) {
    console.error('Google Auth error:', err.message);
    return errorResponse('Google authentication failed: ' + err.message, 500);
  }
}
