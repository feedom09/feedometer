/**
 * workers/services/event-matcher.js — FeedOmeter Event Ingestion & Matcher Engine
 * Claims queued feed_events with distributed lease locking, evaluates against active user_alerts and user_webhooks,
 * and generates pending delivery tasks into alert_deliveries and webhook_deliveries.
 */
import { generateRandomHex } from '../lib/crypto.js';
import { evaluateArticleAgainstRule } from './rule-engine.js';
import { buildArticleMatchedEvent } from './integration-event-contract.js';

/**
 * Emit a new feed event when an article is ingested into the database
 */
export async function emitFeedEvent(env, articleId, sourceId) {
  if (!env.DB || !articleId) return null;
  const eventId = `fev_${generateRandomHex(12)}`;
  const now = Date.now();
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO feed_events (id, article_id, source_id, event_type, status, locked_until, retry_count, created_at)
      VALUES (?, ?, ?, 'ARTICLE_INGESTED', 'pending', 0, 0, ?)
    `).bind(eventId, articleId, sourceId || '', now).run();
    return eventId;
  } catch (err) {
    console.error('Failed to emit feed_event:', err.message);
    return null;
  }
}

/**
 * Atomically claim pending feed events with distributed lease locking
 */
export async function claimPendingFeedEvents(env, batchSize = 25, lockDurationMs = 60000) {
  if (!env.DB) return [];
  const now = Date.now();
  const lockExpires = now + lockDurationMs;

  try {
    const candidates = await env.DB.prepare(`
      SELECT fe.id, fe.article_id, fe.source_id, fe.retry_count,
             a.title, a.url, a.snippet, a.content, a.image_url, a.published_at
      FROM feed_events fe
      JOIN articles a ON a.id = fe.article_id
      WHERE (fe.status = 'pending' OR (fe.status = 'processing' AND fe.locked_until < ?))
        AND fe.retry_count < 3
      ORDER BY fe.created_at ASC
      LIMIT ?
    `).bind(now, batchSize).all();

    const rows = candidates.results || [];
    if (rows.length === 0) return [];

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    await env.DB.prepare(`
      UPDATE feed_events 
      SET status = 'processing', locked_until = ?
      WHERE id IN (${placeholders})
    `).bind(lockExpires, ...ids).run();

    return rows;
  } catch (err) {
    console.error('Error claiming feed events:', err.message);
    return [];
  }
}

/**
 * Process event queue: Evaluate claimed articles against active rules & insert outbox delivery jobs
 */
export async function processFeedEventQueue(env, batchSize = 25) {
  if (!env.DB) return { processed: 0, alertJobsCreated: 0, webhookJobsCreated: 0 };

  const claimedEvents = await claimPendingFeedEvents(env, batchSize);
  if (claimedEvents.length === 0) {
    return { processed: 0, alertJobsCreated: 0, webhookJobsCreated: 0 };
  }

  const now = Date.now();
  let alertJobsCreated = 0;
  let webhookJobsCreated = 0;

  try {
    // 1. Fetch active alerts and active webhooks
    const [alertsResult, webhooksResult] = await Promise.all([
      env.DB.prepare('SELECT id, user_id, name, alert_type, config_json, delivery_channels FROM user_alerts WHERE is_active = 1').all(),
      env.DB.prepare('SELECT id, user_id, name, target_url, secret_key, config_json, cadence FROM user_webhooks WHERE is_active = 1').all()
    ]);

    const activeAlerts = (alertsResult.results || []).map(a => {
      let config = {};
      let channels = ['in_app'];
      try { config = JSON.parse(a.config_json || '{}'); } catch (_) {}
      try { channels = JSON.parse(a.delivery_channels || '["in_app"]'); } catch (_) {}
      return { id: a.id, user_id: a.user_id, name: a.name, alert_type: a.alert_type, config, channels };
    });

    const activeWebhooks = (webhooksResult.results || []).map(w => {
      let config = {};
      try { config = JSON.parse(w.config_json || '{}'); } catch (_) {}
      return { id: w.id, user_id: w.user_id, name: w.name, target_url: w.target_url, secret_key: w.secret_key, config, cadence: w.cadence || 'realtime' };
    });

    // 2. Evaluate each claimed article against alerts & webhooks
    for (const event of claimedEvents) {
      const articleItem = {
        id: event.article_id,
        source_id: event.source_id,
        title: event.title,
        url: event.url,
        summary: event.snippet,
        content: event.content,
        image: event.image_url,
        published: event.published_at
      };

      // Match against User Alerts
      for (const alert of activeAlerts) {
        const evalResult = evaluateArticleAgainstRule(articleItem, alert.config);
        if (evalResult.matched) {
          for (const channel of alert.channels) {
            const deliveryId = `adl_${generateRandomHex(12)}`;
            await env.DB.prepare(`
              INSERT OR IGNORE INTO alert_deliveries (id, alert_id, article_id, channel, status, locked_until, attempt_count, created_at)
              VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)
            `).bind(deliveryId, alert.id, event.article_id, channel, now).run();
            alertJobsCreated++;
          }
        }
      }

      // Match against User Webhooks (Only queue immediate outbox task if cadence == 'realtime')
      for (const webhook of activeWebhooks) {
        if (webhook.cadence !== 'realtime') continue; // Scheduled webhooks are aggregated by cron
        const evalResult = evaluateArticleAgainstRule(articleItem, webhook.config);
        if (evalResult.matched) {
          const deliveryId = `whd_${generateRandomHex(12)}`;
          const payload = JSON.stringify(buildArticleMatchedEvent({
            deliveryId,
            webhookId: webhook.id,
            occurredAt: now,
            article: {
              id: event.article_id,
              title: event.title,
              url: event.url,
              snippet: event.snippet,
              image: event.image_url,
              sourceId: event.source_id,
              publishedAt: event.published_at
            },
            matchedKeywords: evalResult.matchedKeywords || []
          }));

          await env.DB.prepare(`
            INSERT OR IGNORE INTO webhook_deliveries (id, webhook_id, article_id, payload_json, status, locked_until, attempt_count, created_at)
            VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)
          `).bind(deliveryId, webhook.id, event.article_id, payload, now).run();
          webhookJobsCreated++;
        }
      }

      // Mark event as completed
      await env.DB.prepare(`
        UPDATE feed_events 
        SET status = 'completed', processed_at = ?, locked_until = 0
        WHERE id = ?
      `).bind(now, event.id).run();
    }

    return {
      processed: claimedEvents.length,
      alertJobsCreated,
      webhookJobsCreated
    };
  } catch (err) {
    console.error('Error processing feed event queue:', err.message);
    return { processed: 0, alertJobsCreated, webhookJobsCreated, error: err.message };
  }
}
