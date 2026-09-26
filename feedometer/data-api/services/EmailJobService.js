/**
 * FeedOmeter 2.1 — EmailJobService
 * Domain Service for Email Deliveries, Verification Tokens, Password Resets, Welcomes & Digests
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

class EmailJobService {
  /**
   * Core Outbound Delivery via Resend HTTP API
   */
  async sendEmail({ to, subject, html, text = '' }) {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL || 'FeedOm <noreply@peopledotsports.com>';

    if (!resendApiKey) {
      console.log(`[EmailJobService (Mock)] To: ${to} | Subject: ${subject}`);
      return { success: true, mocked: true, message: 'Email queued (RESEND_API_KEY not configured)' };
    }

    try {
      console.log(`[Resend Outbound] Sending email to: ${to} | From: ${fromEmail} | Subject: ${subject}`);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail.includes('<') ? fromEmail : `FeedOm <${fromEmail}>`,
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
          text: text || html.replace(/<[^>]*>?/gm, '')
        })
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('[Resend Outbound Failed]', response.status, data);
        return { success: false, error: data.message || 'Resend delivery failed' };
      }

      console.log(`[Resend Outbound Success] Email delivered. Message ID: ${data.id}`);
      return { success: true, data };
    } catch (err) {
      console.error('[Resend Outbound Network Error]', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 1. Verification Email
   */
  async sendVerificationEmail(userId, email, name = '') {
    const evId = 'ev_' + crypto.randomBytes(12).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = Date.now();
    const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours

    await query(`
      INSERT INTO dbo.email_verifications (id, user_id, token_hash, expires_at, used, created_at)
      VALUES (@id, @userId, @hash, @expiresAt, 0, @now)
    `, {
      id: { type: sql.NVarChar(64), value: evId },
      userId: { type: sql.NVarChar(64), value: userId },
      hash: { type: sql.NVarChar(64), value: tokenHash },
      expiresAt: { type: sql.BigInt, value: expiresAt },
      now: { type: sql.BigInt, value: now }
    });

    const baseUrl = process.env.LOCAL_FRONTEND_ORIGIN || 'http://localhost:3000';
    const verifyLink = `${baseUrl}/shell.html?verify_email_token=${token}`;
    const safeName = escapeHtml(name || email.split('@')[0]);

    return this.sendEmail({
      to: email,
      subject: 'Verify your FeedOmeter account',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <div style="margin-bottom: 24px;">
            <p style="margin: 0 0 8px 0; color: #6366f1; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">FEEDOMETER</p>
            <h1 style="color: #0f172a; font-size: 24px; font-weight: 750; margin: 0 0 8px 0;">Welcome, ${safeName}!</h1>
            <p style="color: #64748b; font-size: 15px; line-height: 1.5; margin: 0;">Please verify your email address to secure your account and start personalizing your feed intelligence.</p>
          </div>
          
          <div style="padding: 24px 0; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; margin-bottom: 24px;">
            <div style="text-align: center; margin: 16px 0 24px 0;">
              <a href="${verifyLink}" style="background-color: #6366f1; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);">Verify My Account</a>
            </div>
            <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">
              Or copy and paste this link in your browser:<br>
              <a href="${verifyLink}" style="color: #6366f1; word-break: break-all;">${verifyLink}</a>
            </p>
          </div>

          <p style="color: #94a3b8; font-size: 12px; margin: 0;">This link will expire in 24 hours. If you did not create this account, you can safely ignore this email.</p>
        </div>
      `
    });
  }

  /**
   * 2. Welcome Email (Dispatched after email verification)
   */
  async sendWelcomeEmail(email, name = '') {
    const safeName = escapeHtml(name || email.split('@')[0]);
    const baseUrl = process.env.LOCAL_FRONTEND_ORIGIN || 'http://localhost:3000';
    const appUrl = `${baseUrl}/shell.html`;

    return this.sendEmail({
      to: email,
      subject: 'Welcome to FeedOmeter — Your Personal Feed Intelligence is Ready',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <div style="margin-bottom: 24px;">
            <p style="margin: 0 0 8px 0; color: #10b981; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">ACCOUNT ACTIVATED</p>
            <h1 style="color: #0f172a; font-size: 24px; font-weight: 750; margin: 0 0 10px 0;">Welcome aboard, ${safeName}! 🎉</h1>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0;">
              Your email address has been successfully verified. You now have full access to FeedOmeter 2.1 to curate, discover, and organize all your information feeds in one place.
            </p>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
            <h3 style="color: #1e293b; font-size: 16px; margin: 0 0 12px 0;">Quick things you can do right now:</h3>
            <ul style="color: #475569; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li><strong>Discover Sources:</strong> Search across verified publications, sports blogs, tech, and global news.</li>
              <li><strong>Visual Feed Builder:</strong> Turn any website into a custom RSS stream.</li>
              <li><strong>Keyword Alerts:</strong> Get notified whenever specific topics or keywords are mentioned.</li>
              <li><strong>Curate Collections:</strong> Tag and save articles for reading later or sharing with your team.</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 28px 0;">
            <a href="${appUrl}" style="background-color: #0f172a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block;">Open FeedOmeter Dashboard</a>
          </div>

          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            FeedOmeter 2.1 — Personal Feed Intelligence Platform. Need help? Reply directly to this email.
          </p>
        </div>
      `
    });
  }

  /**
   * 3. Password Reset Request Email
   */
  async sendPasswordResetEmail(email) {
    const cleanEmail = email.trim().toLowerCase();
    const userRes = await query(`SELECT id, display_name FROM dbo.users WHERE email = @email AND status = 'active'`, {
      email: { type: sql.NVarChar(255), value: cleanEmail }
    });

    if (!userRes.recordset || userRes.recordset.length === 0) {
      return { success: true, message: 'If an account exists, a reset link has been dispatched.' };
    }

    const user = userRes.recordset[0];
    const prtId = 'prt_' + crypto.randomBytes(12).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = Date.now();
    const expiresAt = now + (60 * 60 * 1000); // 1 hour

    await query(`
      INSERT INTO dbo.password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at)
      VALUES (@id, @userId, @hash, @expiresAt, 0, @now)
    `, {
      id: { type: sql.NVarChar(64), value: prtId },
      userId: { type: sql.NVarChar(64), value: user.id },
      hash: { type: sql.NVarChar(64), value: tokenHash },
      expiresAt: { type: sql.BigInt, value: expiresAt },
      now: { type: sql.BigInt, value: now }
    });

    const baseUrl = process.env.LOCAL_FRONTEND_ORIGIN || 'http://localhost:3000';
    const resetLink = `${baseUrl}/shell.html?reset_token=${token}`;

    return this.sendEmail({
      to: cleanEmail,
      subject: 'Reset your FeedOmeter Password',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <p style="margin: 0 0 8px 0; color: #ef4444; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">SECURITY</p>
          <h2 style="color: #0f172a; font-size: 22px; font-weight: 750; margin: 0 0 12px 0;">Reset Your Password</h2>
          <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
            We received a request to reset the password for your FeedOmeter account (<strong>${cleanEmail}</strong>). Click the button below to set a new password:
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${resetLink}" style="background-color: #0f172a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block;">Reset My Password</a>
          </div>
          <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">
            Or use this link in your browser:<br>
            <a href="${resetLink}" style="color: #6366f1; word-break: break-all;">${resetLink}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">This link expires in 60 minutes. If you did not request this, your password remains unchanged.</p>
        </div>
      `
    });
  }

  /**
   * 4. Password-Changed Confirmation Email
   */
  async sendPasswordChangedEmail(email, name = '') {
    const safeName = escapeHtml(name || email.split('@')[0]);

    return this.sendEmail({
      to: email,
      subject: 'Security Alert: Your FeedOmeter password has been updated',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <p style="margin: 0 0 8px 0; color: #10b981; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">SECURITY NOTICE</p>
          <h2 style="color: #0f172a; font-size: 22px; font-weight: 750; margin: 0 0 12px 0;">Password Successfully Changed</h2>
          <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
            Hi ${safeName}, this is a confirmation that the password for your FeedOmeter account (<strong>${email}</strong>) was just changed.
          </p>
          <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 14px 16px; margin-bottom: 20px; border-radius: 4px;">
            <p style="color: #991b1b; font-size: 13px; line-height: 1.5; margin: 0;">
              <strong>Didn't make this change?</strong> If you did not change your password, please reset your password immediately and contact support.
            </p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            FeedOmeter Security Team • ${new Date().toUTCString()}
          </p>
        </div>
      `
    });
  }

  /**
   * 5. Keyword Alert Notification Email
   */
  async sendKeywordAlertEmail({ email, alertName, articleTitle, articleUrl, snippet = '', sourceName = '' }) {
    const safeAlertName = escapeHtml(alertName);
    const safeTitle = escapeHtml(articleTitle);
    const safeUrl = escapeHtml(articleUrl);
    const safeSnippet = escapeHtml(snippet);
    const safeSource = escapeHtml(sourceName || 'RSS Feed');

    return this.sendEmail({
      to: email,
      subject: `🚨 FeedOmeter Alert: ${alertName} — "${articleTitle.substring(0, 50)}..."`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <p style="margin: 0 0 8px 0; color: #f59e0b; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">KEYWORD ALERT MATCH</p>
          <h2 style="color: #0f172a; font-size: 20px; font-weight: 750; margin: 0 0 8px 0;">${safeAlertName}</h2>
          <p style="color: #64748b; font-size: 13px; margin: 0 0 20px 0;">Source: <strong>${safeSource}</strong></p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <h3 style="margin: 0 0 8px 0; font-size: 17px; line-height: 1.4;">
              <a href="${safeUrl}" style="color: #6366f1; text-decoration: none;">${safeTitle}</a>
            </h3>
            ${safeSnippet ? `<p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">${safeSnippet}</p>` : ''}
          </div>

          <div style="text-align: center; margin-bottom: 20px;">
            <a href="${safeUrl}" style="background-color: #6366f1; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; display: inline-block;">Read Full Article &rarr;</a>
          </div>

          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">You received this because you created an active alert rule for "${safeAlertName}".</p>
        </div>
      `
    });
  }

  /**
   * 6. Daily / Weekly Curated Digest Email
   */
  async sendDigestEmail({ email, digestName, articles = [] }) {
    const safeDigestName = escapeHtml(digestName);
    const articlesHtml = articles.map(a => `
      <div style="padding: 16px 0; border-bottom: 1px solid #f1f5f9;">
        <h3 style="margin: 0 0 6px 0; font-size: 16px; line-height: 1.4;">
          <a href="${escapeHtml(a.url)}" style="color: #0f172a; text-decoration: none; font-weight: 600;">${escapeHtml(a.title)}</a>
        </h3>
        <p style="color: #64748b; font-size: 12px; margin: 0 0 6px 0;">${escapeHtml(a.source_name || '')} • ${new Date(a.published_at || Date.now()).toLocaleDateString()}</p>
        ${a.snippet ? `<p style="color: #475569; font-size: 13px; line-height: 1.5; margin: 0;">${escapeHtml(a.snippet.substring(0, 160))}...</p>` : ''}
      </div>
    `).join('');

    return this.sendEmail({
      to: email,
      subject: `📰 FeedOmeter Digest: ${digestName} (${articles.length} new items)`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <p style="margin: 0 0 8px 0; color: #6366f1; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">FEEDOMETER DIGEST</p>
          <h1 style="color: #0f172a; font-size: 24px; font-weight: 750; margin: 0 0 6px 0;">${safeDigestName}</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">Here is your curated reading summary for today.</p>
          
          <div style="border-top: 1px solid #e2e8f0; margin-bottom: 24px;">
            ${articlesHtml || '<p style="color: #64748b; padding: 20px 0;">No new articles matched this digest schedule.</p>'}
          </div>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${process.env.LOCAL_FRONTEND_ORIGIN || 'http://localhost:3000'}/shell.html" style="background-color: #0f172a; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; display: inline-block;">Open FeedOmeter &rarr;</a>
          </div>

          <p style="color: #94a3b8; font-size: 12px; margin: 0; text-align: center;">FeedOmeter 2.1 — Personal Feed Intelligence</p>
        </div>
      `
    });
  }
}

module.exports = new EmailJobService();
