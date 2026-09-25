/**
 * workers/services/alert-dispatcher.js — FeedOmeter Multi-Channel Alert Dispatcher
 * In-App Notification Ledger, Web Push VAPID Dispatching, and Live Rule Match Testing
 */
import { evaluateArticleAgainstRule } from './rule-engine.js';
import { sendTransactionalEmail } from './email-service.js';
import { keywordAlertEmail } from './email-templates.js';

/**
 * Atomically claim pending alert delivery tasks
 */
export async function claimPendingAlertDeliveries(env, limit = 20, lockDurationMs = 60000) {
  if (!env.DB) return [];
  const now = Date.now();
  const lockExpires = now + lockDurationMs;

  try {
    const candidates = await env.DB.prepare(`
      SELECT ad.id, ad.alert_id, ad.article_id, ad.channel, ad.attempt_count,
             ua.user_id, ua.name as alert_name, u.email as user_email, p.email_notifications,
             a.title as article_title, a.url as article_url, a.snippet as article_snippet, a.image_url as article_image
      FROM alert_deliveries ad
      JOIN user_alerts ua ON ua.id = ad.alert_id
      JOIN articles a ON a.id = ad.article_id
      JOIN users u ON u.id = ua.user_id
      LEFT JOIN user_preferences p ON p.user_id = ua.user_id
      WHERE (ad.status = 'pending' OR (ad.status = 'processing' AND ad.locked_until < ?))
        AND ad.attempt_count < 3
        AND ua.is_active = 1
      ORDER BY ad.created_at ASC
      LIMIT ?
    `).bind(now, limit).all();

    const rows = candidates.results || [];
    if (rows.length === 0) return [];

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    await env.DB.prepare(`
      UPDATE alert_deliveries 
      SET status = 'processing', locked_until = ?
      WHERE id IN (${placeholders})
    `).bind(lockExpires, ...ids).run();

    return rows;
  } catch (err) {
    console.error('Error claiming alert deliveries:', err.message);
    return [];
  }
}

/**
 * Execute a single alert delivery
 */
export async function executeSingleAlertDelivery(env, delivery) {
  const now = Date.now();
  let success = true;
  let errorMsg = null;

  try {
    if (delivery.channel === 'in_app') {
      // In-app notifications are instantly accessible from the delivery record itself
      success = true;
    } else if (delivery.channel === 'email') {
      if (delivery.email_notifications === 0) { success = true; }
      else {
        const result = await sendTransactionalEmail(env, { to: delivery.user_email, ...keywordAlertEmail({ alertName: delivery.alert_name, articleTitle: delivery.article_title, articleUrl: delivery.article_url, snippet: delivery.article_snippet }) });
        success = result.ok;
        errorMsg = result.code || null;
      }
    } else {
      // Never pretend a raw fetch is a valid Web Push or email delivery.
      success = false;
      errorMsg = `Delivery channel '${delivery.channel}' is not configured`;
    }
  } catch (err) {
    success = false;
    errorMsg = err.message;
  }

  const nextAttempt = (delivery.attempt_count || 0) + 1;
  if (success) {
    await env.DB.prepare(`
      UPDATE alert_deliveries 
      SET status = 'sent', sent_at = ?, locked_until = 0
      WHERE id = ?
    `).bind(now, delivery.id).run();
  } else {
    const finalStatus = nextAttempt >= 3 ? 'failed' : 'pending';
    await env.DB.prepare(`
      UPDATE alert_deliveries 
      SET status = ?, attempt_count = ?, error_message = ?, locked_until = 0
      WHERE id = ?
    `).bind(finalStatus, nextAttempt, errorMsg, delivery.id).run();
  }

  return { success, channel: delivery.channel };
}

/**
 * Dispatch pending alerts batch
 */
export async function dispatchPendingAlerts(env, limit = 20) {
  if (!env.DB) return { sent: 0, failed: 0 };
  const claimed = await claimPendingAlertDeliveries(env, limit);
  if (claimed.length === 0) return { sent: 0, failed: 0 };

  const results = await Promise.allSettled(
    claimed.map(item => executeSingleAlertDelivery(env, item))
  );

  let sent = 0;
  let failed = 0;
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.success) sent++;
    else failed++;
  });

  return { total: claimed.length, sent, failed };
}

/**
 * Sends the legacy keyword-alert records that predate the general alert outbox.
 * last_notified_at is the durable cursor, so each matching article window is
 * mailed once rather than on every 15-minute cron invocation.
 */
export async function dispatchLegacyKeywordAlertEmails(env, limit = 20) {
  if (!env.DB || !env.RESEND_API_KEY) return { sent: 0, skipped: 0 };
  const now = Date.now();
  const rows = await env.DB.prepare(`
    SELECT ka.id, ka.keyword, ka.last_notified_at, u.email, p.email_notifications
    FROM keyword_alerts ka JOIN users u ON u.id = ka.user_id
    LEFT JOIN user_preferences p ON p.user_id = ka.user_id
    WHERE ka.is_active = 1 AND ka.notification_channel IN ('email', 'both')
    ORDER BY ka.last_notified_at ASC LIMIT ?
  `).bind(limit).all();
  let sent = 0; let skipped = 0;
  for (const alert of rows.results || []) {
    if (alert.email_notifications === 0) { skipped++; continue; }
    const since = Number(alert.last_notified_at) || now - 24 * 60 * 60 * 1000;
    const candidates = await env.DB.prepare(`SELECT title, url, snippet FROM articles WHERE ingested_at > ? ORDER BY ingested_at ASC LIMIT 1`).bind(since).all();
    const article = (candidates.results || []).find(a => `${a.title || ''} ${a.snippet || ''}`.toLowerCase().includes(String(alert.keyword || '').toLowerCase()));
    if (!article) continue;
    const delivery = await sendTransactionalEmail(env, { to: alert.email, ...keywordAlertEmail({ alertName: `Keyword: ${alert.keyword}`, articleTitle: article.title, articleUrl: article.url, snippet: article.snippet }) });
    if (delivery.ok) {
      await env.DB.prepare('UPDATE keyword_alerts SET match_count = match_count + 1, last_notified_at = ? WHERE id = ?').bind(now, alert.id).run();
      sent++;
    }
  }
  return { sent, skipped };
}

/**
 * Test an alert configuration against recent articles
 */
export async function testAlertMatch(env, config, limit = 20) {
  if (!env.DB) return { matches: [] };
  try {
    const recent = await env.DB.prepare(`
      SELECT id, title, url, snippet, image_url, published_at, source_id
      FROM articles
      ORDER BY published_at DESC
      LIMIT ?
    `).bind(limit).all();

    const articles = recent.results || [];
    const matched = [];

    for (const art of articles) {
      const item = {
        id: art.id,
        source_id: art.source_id,
        title: art.title,
        url: art.url,
        summary: art.snippet,
        image: art.image_url,
        published: art.published_at
      };
      const result = evaluateArticleAgainstRule(item, config);
      if (result.matched) {
        matched.push(Object.assign({}, item, { matchedKeywords: result.matchedKeywords }));
      }
    }

    return { totalChecked: articles.length, matchedCount: matched.length, matches: matched };
  } catch (err) {
    return { error: err.message, matches: [] };
  }
}
