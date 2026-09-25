/**
 * workers/modules/subscriptions.js — Feed Subscriptions & Catalog Ingestion
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { detectSourceType } from '../services/source-detector.js';
import { ensureSourceLifecycle } from '../services/source-lifecycle.js';
import { validateSourceInput } from '../services/source-intake.js';

export async function handleListSubscriptions(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT 
        uf.id AS subscription_id,
        uf.followed_at,
        s.id AS source_id,
        s.title,
        s.feed_url,
        s.website_url,
        s.category,
        s.logo_url,
        s.is_verified,
        sh.last_http_status,
        sh.response_ms,
        sh.consecutive_failures,
        COALESCE(sl.state, CASE s.status WHEN 'paused' THEN 'paused' WHEN 'failing' THEN 'failing' ELSE 'pending' END) AS lifecycle_state,
        COALESCE(sl.state_reason, '') AS lifecycle_reason,
        sl.last_success_at AS lifecycle_last_success_at,
        sl.next_retry_at AS lifecycle_next_retry_at
      FROM user_feeds uf
      JOIN sources s ON uf.source_id = s.id
      LEFT JOIN source_health sh ON s.id = sh.source_id
      LEFT JOIN source_lifecycle sl ON s.id = sl.source_id
      WHERE uf.user_id = ?
      ORDER BY uf.followed_at DESC
    `).bind(session.userId).all();

    return jsonResponse({
      status: 'success',
      subscriptions: rows.results || []
    });
  } catch (err) {
    console.error('List subscriptions error:', err.message);
    return errorResponse('Failed to list subscriptions', 500);
  }
}

export async function handleCreateSubscription(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const requestedFeedUrl = (body.feed_url || '').trim();
    const title = (body.title || 'RSS Feed').trim();
    const category = (body.category || 'general').trim();
    const folderId = body.folder_id || null;

    const validation = validateSourceInput(requestedFeedUrl);
    if (!validation.ok) return errorResponse(validation.message, 400, validation.code);
    const feedUrl = validation.normalized;
    const detected = validation.detected || detectSourceType(feedUrl);
    let sourceType = body.source_type || (detected ? detected.type : 'rss');
    if (sourceType === 'rss_atom') sourceType = 'rss';

    // 1. Check if source already exists in master catalog
    let source = await env.DB.prepare('SELECT id, title, feed_url FROM sources WHERE feed_url = ?')
      .bind(feedUrl).first();

    let sourceId = source ? source.id : null;

    if (!sourceId) {
      sourceId = `src_${generateRandomHex(12)}`;
      try {
        await env.DB.prepare(`
          INSERT INTO sources (id, title, feed_url, category, source_type, status)
          VALUES (?, ?, ?, ?, ?, 'active')
        `).bind(sourceId, title, feedUrl, category, sourceType).run();
      } catch (e) {
        const existing = await env.DB.prepare('SELECT id FROM sources WHERE feed_url = ?').bind(feedUrl).first();
        if (existing) sourceId = existing.id;
      }

      // Init health record
      await env.DB.prepare('INSERT OR IGNORE INTO source_health (source_id) VALUES (?)')
        .bind(sourceId).run().catch(() => {});
      await ensureSourceLifecycle(env, sourceId, 'pending').catch(() => {});
    }
    // Catalog sources from before Phase 1 may not yet have a lifecycle row.
    await ensureSourceLifecycle(env, sourceId, 'pending').catch(() => {});

    // 2. Insert into user_feeds
    const subscriptionId = `uf_${generateRandomHex(12)}`;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO user_feeds (id, user_id, source_id, followed_at)
      VALUES (?, ?, ?, ?)
    `).bind(subscriptionId, session.userId, sourceId, Date.now()).run();

    // 3. If folder_id provided, assign to folder
    if (folderId) {
      const assignmentId = `ufa_${generateRandomHex(12)}`;
      await env.DB.prepare(`
        INSERT OR IGNORE INTO user_feed_assignments (id, user_id, feed_id, folder_id, assigned_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(assignmentId, session.userId, sourceId, folderId, Date.now()).run();
    }

    return jsonResponse({
      status: 'success',
      message: 'Subscribed to feed successfully',
      subscription: {
        id: subscriptionId,
        source_id: sourceId,
        title: title,
        feed_url: feedUrl
      }
    }, 201);

  } catch (err) {
    console.error('Create subscription error:', err.message);
    return errorResponse('Failed to create subscription', 500);
  }
}

export async function handleDeleteSubscription(request, subscriptionOrSourceId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    // Determine if passed ID is subscription ID or source ID
    let sub = await env.DB.prepare('SELECT id, source_id FROM user_feeds WHERE (id = ? OR source_id = ?) AND user_id = ?')
      .bind(subscriptionOrSourceId, subscriptionOrSourceId, session.userId).first();

    if (!sub) {
      return errorResponse('Subscription not found', 404, 'NOT_FOUND');
    }

    await env.DB.prepare('DELETE FROM user_feeds WHERE id = ? AND user_id = ?')
      .bind(sub.id, session.userId).run();

    await env.DB.prepare('DELETE FROM user_feed_assignments WHERE feed_id = ? AND user_id = ?')
      .bind(sub.source_id, session.userId).run();

    return jsonResponse({ status: 'success', message: 'Unsubscribed successfully' });

  } catch (err) {
    console.error('Delete subscription error:', err.message);
    return errorResponse('Failed to delete subscription', 500);
  }
}
