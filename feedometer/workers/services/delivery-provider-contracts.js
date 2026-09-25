/** Provider-neutral readiness checks. No external delivery is attempted here. */
export function getEmailProviderReadiness(env = {}) {
  const sender = env.MAIL_FROM || env.EMAIL_FROM;
  return {
    available: Boolean(env.RESEND_API_KEY && sender),
    provider: env.RESEND_API_KEY ? 'resend' : null,
    reason: env.RESEND_API_KEY && sender ? null : 'Transactional email provider is not configured.'
  };
}
export function getWebPushReadiness(env = {}) {
  return { available: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), reason: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? null : 'Web Push VAPID keys are not configured.' };
}
export function getConnectorReadiness(code) {
  const supported = new Set(['slack', 'teams', 'webhook']);
  return { available: supported.has(String(code || '').toLowerCase()), reason: supported.has(String(code || '').toLowerCase()) ? null : 'This connector is not available yet.' };
}
