/**
 * FeedOmeter 2.1 — UserService
 * Domain Service for User Profile, Preferences, Usage Telemetry & Settings
 */

const { query, sql } = require('../config/db');

class UserService {
  /**
   * Get user profile details along with preferences and active counts
   */
  async getProfile(userId) {
    const userRes = await query(`
      SELECT 
        u.id, u.email, u.display_name, u.first_name, u.last_name, u.avatar_url, u.[plan], u.status, u.email_verified, u.created_at, u.last_login,
        p.theme, p.reading_mode, p.default_view, p.font_size, p.timezone, p.language, p.date_format, p.email_notifications, p.auto_mark_read,
        (SELECT COUNT(*) FROM dbo.user_feeds WHERE user_id = u.id) AS feed_count,
        (SELECT COUNT(*) FROM dbo.folders WHERE user_id = u.id) AS folder_count,
        (SELECT COUNT(*) FROM dbo.starred_articles WHERE user_id = u.id) AS starred_count,
        (SELECT COUNT(*) FROM dbo.saved_articles WHERE user_id = u.id) AS saved_count,
        (SELECT COUNT(*) FROM dbo.user_alerts WHERE user_id = u.id AND is_active = 1) AS alert_count
      FROM dbo.users u
      LEFT JOIN dbo.user_preferences p ON u.id = p.user_id
      WHERE u.id = @userId AND u.status != 'deleted'
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    if (!userRes.recordset || userRes.recordset.length === 0) {
      throw new Error('User not found.');
    }

    return userRes.recordset[0];
  }

  /**
   * Update profile details (display_name, avatar_url, first_name, last_name)
   */
  async updateProfile(userId, { name, displayName, firstName, lastName, avatar_url }) {
    const now = Date.now();
    await query(`
      UPDATE dbo.users 
      SET 
        display_name = COALESCE(@displayName, display_name),
        first_name = COALESCE(@firstName, first_name),
        last_name = COALESCE(@lastName, last_name),
        avatar_url = COALESCE(@avatar_url, avatar_url),
        updated_at = @now
      WHERE id = @userId
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      displayName: { type: sql.NVarChar(150), value: displayName || name || null },
      firstName: { type: sql.NVarChar(100), value: firstName || null },
      lastName: { type: sql.NVarChar(100), value: lastName || null },
      avatar_url: { type: sql.NVarChar(500), value: avatar_url || null },
      now: { type: sql.BigInt, value: now }
    });

    return this.getProfile(userId);
  }

  /**
   * Update reading & UI preferences
   */
  async updatePreferences(userId, prefs = {}) {
    const {
      theme,
      reading_mode,
      default_view,
      font_size,
      timezone,
      language,
      date_format,
      email_notifications,
      auto_mark_read
    } = prefs;
    const now = Date.now();

    // Check if record exists
    const check = await query(`SELECT user_id FROM dbo.user_preferences WHERE user_id = @userId`, {
      userId: { type: sql.NVarChar(64), value: userId }
    });

    if (check.recordset && check.recordset.length > 0) {
      await query(`
        UPDATE dbo.user_preferences
        SET
          theme = COALESCE(@theme, theme),
          reading_mode = COALESCE(@reading_mode, reading_mode),
          default_view = COALESCE(@default_view, default_view),
          font_size = COALESCE(@font_size, font_size),
          timezone = COALESCE(@timezone, timezone),
          language = COALESCE(@language, language),
          date_format = COALESCE(@date_format, date_format),
          email_notifications = COALESCE(@email_notifications, email_notifications),
          auto_mark_read = COALESCE(@auto_mark_read, auto_mark_read),
          updated_at = @now
        WHERE user_id = @userId
      `, {
        userId: { type: sql.NVarChar(64), value: userId },
        theme: { type: sql.NVarChar(20), value: theme || null },
        reading_mode: { type: sql.NVarChar(20), value: reading_mode || null },
        default_view: { type: sql.NVarChar(50), value: default_view || null },
        font_size: { type: sql.NVarChar(20), value: font_size || null },
        timezone: { type: sql.NVarChar(50), value: timezone || null },
        language: { type: sql.NVarChar(20), value: language || null },
        date_format: { type: sql.NVarChar(30), value: date_format || null },
        email_notifications: { type: sql.TinyInt, value: email_notifications !== undefined ? (email_notifications ? 1 : 0) : null },
        auto_mark_read: { type: sql.TinyInt, value: auto_mark_read !== undefined ? (auto_mark_read ? 1 : 0) : null },
        now: { type: sql.BigInt, value: now }
      });
    } else {
      await query(`
        INSERT INTO dbo.user_preferences (user_id, theme, reading_mode, font_size, default_view, timezone, language, date_format, email_notifications, auto_mark_read, updated_at)
        VALUES (@userId, @theme, @reading_mode, @font_size, @default_view, @timezone, @language, @date_format, @email_notifications, @auto_mark_read, @now)
      `, {
        userId: { type: sql.NVarChar(64), value: userId },
        theme: { type: sql.NVarChar(20), value: theme || 'system' },
        reading_mode: { type: sql.NVarChar(20), value: reading_mode || 'cards' },
        font_size: { type: sql.NVarChar(20), value: font_size || 'medium' },
        default_view: { type: sql.NVarChar(50), value: default_view || 'home' },
        timezone: { type: sql.NVarChar(50), value: timezone || 'UTC' },
        language: { type: sql.NVarChar(20), value: language || 'en' },
        date_format: { type: sql.NVarChar(30), value: date_format || 'YYYY-MM-DD' },
        email_notifications: { type: sql.TinyInt, value: email_notifications !== undefined ? (email_notifications ? 1 : 0) : 1 },
        auto_mark_read: { type: sql.TinyInt, value: auto_mark_read !== undefined ? (auto_mark_read ? 1 : 0) : 0 },
        now: { type: sql.BigInt, value: now }
      });
    }

    return { success: true, message: 'Preferences updated successfully.' };
  }

  /**
   * Save early access / newsletter notify signup
   */
  async saveNotifySignup({ email, source = 'web', country = null, city = null }) {
    const cleanEmail = email.trim().toLowerCase();
    const nowIso = new Date().toISOString();

    await query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.notify_signups WHERE email = @email)
      BEGIN
        INSERT INTO dbo.notify_signups (email, joined_at, [source], country, city, synced_at)
        VALUES (@email, @nowIso, @source, @country, @city, @nowIso)
      END
    `, {
      email: { type: sql.NVarChar(255), value: cleanEmail },
      source: { type: sql.NVarChar(100), value: source },
      country: { type: sql.NVarChar(100), value: country },
      city: { type: sql.NVarChar(100), value: city },
      nowIso: { type: sql.NVarChar(50), value: nowIso }
    });

    return { success: true, message: 'Signup recorded successfully.' };
  }
}

module.exports = new UserService();
