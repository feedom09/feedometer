/**
 * workers/services/email-templates.js — trusted transactional email content.
 *
 * Keep dynamic values escaped here so every delivery caller receives the same
 * accessible, brand-consistent, and injection-safe markup.
 */

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

export function passwordResetEmail({ resetUrl, expiresInMinutes = 60 }) {
  const safeUrl = String(resetUrl || '');
  const safeMinutes = Number(expiresInMinutes) || 60;
  return {
    subject: 'Reset your FeedOmeter password',
    text: [
      'We received a request to reset your FeedOmeter password.',
      '',
      `Use this link within ${safeMinutes} minutes:`,
      safeUrl,
      '',
      'If you did not request this, you can safely ignore this email.'
    ].join('\n'),
    html: `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
  <main style="max-width:560px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:32px;">
    <p style="margin:0 0 12px;color:#10b981;font-size:12px;font-weight:700;letter-spacing:.08em;">FEEDOMETER</p>
    <h1 style="margin:0 0 16px;font-size:24px;">Reset your password</h1>
    <p style="line-height:1.6;">We received a request to reset your FeedOmeter password. This link expires in ${escapeHtml(safeMinutes)} minutes.</p>
    <p style="margin:28px 0;"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;">Reset password</a></p>
    <p style="line-height:1.6;color:#475569;">If you did not request this, you can safely ignore this email. Your password will not change.</p>
  </main>
</body></html>`
  };
}

export function emailVerificationEmail({ verifyUrl }) {
  return {
    subject: 'Verify your FeedOmeter email address',
    text: `Welcome to FeedOmeter. Verify your email address:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p><strong>FEEDOMETER</strong></p><h1>Verify your email address</h1><p>Welcome to FeedOmeter. Please verify your email address to secure your account.</p><p><a href="${escapeHtml(verifyUrl)}">Verify email address</a></p><p>This link expires in 24 hours.</p>`
  };
}

export function welcomeEmail({ name = 'Reader' } = {}) {
  const safeName = escapeHtml(name);
  return { subject: 'Welcome to FeedOmeter', text: `Welcome to FeedOmeter, ${name}. Your email address is verified.`, html: `<p><strong>FEEDOMETER</strong></p><h1>Welcome, ${safeName}</h1><p>Your email address is verified. You can now build, read, and share your feeds.</p>` };
}

export function passwordChangedEmail() {
  return { subject: 'Your FeedOmeter password was changed', text: 'Your FeedOmeter password was changed. If this was not you, reset your password immediately.', html: '<p><strong>FEEDOMETER</strong></p><h1>Password changed</h1><p>Your FeedOmeter password was changed and other active sessions were revoked.</p><p>If this was not you, reset your password immediately.</p>' };
}

export function keywordAlertEmail({ alertName, articleTitle, articleUrl, snippet = '' }) {
  return { subject: `FeedOmeter alert: ${alertName}`, text: `${articleTitle}\n${articleUrl}\n\n${snippet}`, html: `<p><strong>FEEDOMETER ALERT</strong></p><h1>${escapeHtml(alertName)}</h1><p><a href="${escapeHtml(articleUrl)}">${escapeHtml(articleTitle)}</a></p><p>${escapeHtml(snippet)}</p>` };
}
