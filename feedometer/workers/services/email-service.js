/**
 * workers/services/email-service.js — single outbound email boundary.
 *
 * All product email must pass through this module.  It keeps the Resend secret
 * inside the Worker environment, applies conservative timeouts, and returns a
 * small, non-sensitive delivery result to its caller.  Route handlers must not
 * call the Resend HTTP API directly.
 */

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'FeedOmeter <noreply@mail.ev2rule.com>';
const SEND_TIMEOUT_MS = 12_000;

function maskRecipient(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/**
 * Deliver one transactional email through Resend.
 *
 * `RESEND_API_KEY` is intentionally read only from the Worker secret binding;
 * it is never accepted from a request or written to logs.
 */
export async function sendTransactionalEmail(env, message, { fetchImpl = fetch } = {}) {
  const to = String(message?.to || '').trim().toLowerCase();
  if (!isEmailAddress(to)) {
    return { ok: false, code: 'INVALID_RECIPIENT' };
  }
  if (!env?.RESEND_API_KEY) {
    console.warn('Email delivery skipped: RESEND_API_KEY is not configured.');
    return { ok: false, code: 'EMAIL_NOT_CONFIGURED' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetchImpl(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        // EMAIL_FROM is accepted for compatibility with the Phase 5 provider
        // readiness contract; MAIL_FROM is the canonical current variable.
        from: env.MAIL_FROM || env.EMAIL_FROM || DEFAULT_FROM,
        to: [to],
        subject: String(message.subject || 'FeedOmeter notification'),
        text: String(message.text || ''),
        ...(message.html ? { html: String(message.html) } : {})
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`Email delivery failed (${response.status}) for ${maskRecipient(to)}.`, result?.message || 'Unknown provider error');
      return { ok: false, code: 'EMAIL_PROVIDER_ERROR', status: response.status };
    }

    console.info(`Transactional email accepted by Resend for ${maskRecipient(to)}.`, result?.id ? `id=${result.id}` : '');
    return { ok: true, id: result?.id || null };
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'EMAIL_TIMEOUT' : 'EMAIL_NETWORK_ERROR';
    console.error(`Email delivery error (${code}) for ${maskRecipient(to)}.`, error?.message || 'Unknown error');
    return { ok: false, code };
  } finally {
    clearTimeout(timeout);
  }
}
