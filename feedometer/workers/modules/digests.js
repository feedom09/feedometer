/**
 * workers/modules/digests.js — FeedOmeter Scheduled Digests HTTP Route Handlers
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { renderDigestHtml, executeDigestRun } from '../services/digest-generator.js';

export async function handleListDigests(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT ud.id, ud.name, ud.schedule_type, ud.delivery_channel, ud.collection_ids, ud.config_json,
             ud.last_article_at, ud.last_run_at, ud.next_run_at, ud.is_active, ud.created_at,
             COUNT(dr.id) as total_runs,
             MAX(dr.completed_at) as last_completed_at
      FROM user_digests ud
      LEFT JOIN digest_runs dr ON dr.digest_id = ud.id
      WHERE ud.user_id = ?
      GROUP BY ud.id
      ORDER BY ud.created_at DESC
    `).bind(session.userId).all();

    const digests = (rows.results || []).map(d => {
      let config = {};
      let collection_ids = [];
      try { config = JSON.parse(d.config_json || '{}'); } catch (_) {}
      try { collection_ids = JSON.parse(d.collection_ids || '[]'); } catch (_) {}
      return {
        id: d.id,
        name: d.name,
        schedule_type: d.schedule_type,
        delivery_channel: d.delivery_channel,
        collection_ids,
        config,
        is_active: Boolean(d.is_active),
        last_article_at: d.last_article_at,
        last_run_at: d.last_run_at,
        next_run_at: d.next_run_at,
        created_at: d.created_at,
        stats: {
          total_runs: d.total_runs || 0,
          last_completed_at: d.last_completed_at
        }
      };
    });

    return jsonResponse({ status: 'success', digests });
  } catch (err) {
    return errorResponse('Failed to list digests: ' + err.message, 500);
  }
}

export async function handleCreateDigest(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const body = await request.json();
    const name = String(body.name || 'Daily Digest').trim();
    const scheduleType = String(body.schedule_type || 'daily').toLowerCase();
    const deliveryChannel = String(body.delivery_channel || 'in_app').toLowerCase();
    const collectionIds = body.collection_ids || [];
    const config = body.config || body.config_json || {};

    if (!['daily', 'weekly'].includes(scheduleType)) {
      return errorResponse('Schedule type must be daily or weekly', 400);
    }
    if (!['in_app', 'email'].includes(deliveryChannel)) {
      return errorResponse('Choose in-app or email digest delivery.', 400);
    }
    if (deliveryChannel === 'email' && !env.RESEND_API_KEY) {
      return errorResponse('Email delivery is not configured for this environment.', 409, 'DIGEST_CHANNEL_NOT_CONFIGURED');
    }

    const digestId = `dgs_${generateRandomHex(12)}`;
    const now = Date.now();
    const intervalMs = scheduleType === 'weekly' ? 7 * 86400000 : 86400000;
    const nextRunAt = now + intervalMs;

    await env.DB.prepare(`
      INSERT INTO user_digests (id, user_id, name, schedule_type, delivery_channel, collection_ids, config_json, last_article_at, next_run_at, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?)
    `).bind(
      digestId,
      session.userId,
      name,
      scheduleType,
      deliveryChannel,
      JSON.stringify(collectionIds),
      JSON.stringify(config),
      nextRunAt,
      now
    ).run();

    return jsonResponse({
      status: 'success',
      message: 'Digest scheduled successfully',
      digest: {
        id: digestId,
        name,
        schedule_type: scheduleType,
        delivery_channel: deliveryChannel,
        collection_ids: collectionIds,
        config,
        next_run_at: nextRunAt,
        is_active: true,
        created_at: now
      }
    }, 201);
  } catch (err) {
    return errorResponse('Failed to create digest: ' + err.message, 500);
  }
}

export async function handleDeleteDigest(request, digestId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    await env.DB.prepare('DELETE FROM user_digests WHERE id = ? AND user_id = ?')
      .bind(digestId, session.userId).run();
    return jsonResponse({ status: 'success', message: 'Digest deleted successfully' });
  } catch (err) {
    return errorResponse('Failed to delete digest: ' + err.message, 500);
  }
}

export async function handlePreviewDigest(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const body = await request.json();
    const name = body.name || 'Sample Executive Briefing';

    const recent = await env.DB.prepare(`
      SELECT a.id, a.title, a.url, a.snippet, a.image_url, a.published_at, s.title as source_title
      FROM articles a
      LEFT JOIN sources s ON s.id = a.source_id
      ORDER BY a.published_at DESC
      LIMIT 8
    `).all();

    const sampleArticles = (recent.results && recent.results.length > 0)
      ? recent.results
      : [
          {
            title: 'Neural Engine Architecture Redefines Global Edge Processing Benchmarks',
            url: 'https://feedometer.com',
            snippet: 'Next-generation semiconductor accelerators achieve groundbreaking efficiency leaps in distributed edge deployments.',
            source_title: 'TechPulse',
            published_at: Date.now() - 3600000
          },
          {
            title: 'Renewable Clean Grid Deployment Exceeds Target Growth Trajectories',
            url: 'https://feedometer.com',
            snippet: 'Regional power grids surpass seasonal output projections with high-capacity storage network synchronizations.',
            source_title: 'GreenEnergy',
            published_at: Date.now() - 7200000
          }
        ];

    const html = renderDigestHtml(name, sampleArticles, session.email || 'Reader');
    return jsonResponse({ status: 'success', html, articleCount: sampleArticles.length });
  } catch (err) {
    return errorResponse('Failed to generate preview: ' + err.message, 500);
  }
}
