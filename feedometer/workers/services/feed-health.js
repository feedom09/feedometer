/**
 * workers/services/feed-health.js — Feed Health Scoring & Predictive Drift Engine
 * Computes 0-100 health metrics based on field completeness, item volume deviations, and HTTP status.
 */

/**
 * Calculates feed health score (0-100) from field extraction rates and item count deviation
 */
export function calculateFeedHealth(items = [], options = {}) {
  const total = Array.isArray(items) ? items.length : 0;
  if (total === 0) {
    return {
      healthScore: 0,
      fieldHealth: { title: 0, link: 0, date: 0, image: 0 },
      status: 'broken',
      reason: 'No items extracted'
    };
  }

  // 1. Calculate field completeness rates (0.0 to 1.0)
  const titleCount = items.filter(i => i && i.title && i.title.trim().length >= 5 && i.title !== 'Untitled Article').length;
  const linkCount = items.filter(i => i && i.link && /^https?:\/\//i.test(i.link)).length;
  const dateCount = items.filter(i => i && i.pubDate && !isNaN(new Date(i.pubDate).getTime())).length;
  const imageCount = items.filter(i => i && i.image && /^https?:\/\//i.test(i.image)).length;

  const titleRate = titleCount / total;
  const linkRate = linkCount / total;
  const dateRate = dateCount / total;
  const imageRate = imageCount / total;

  // 2. Weighted Score Formula:
  // Title (40%) + Link (30%) + Date (15%) + Image (15%)
  let weightedScore = (titleRate * 40) + (linkRate * 30) + (dateRate * 15) + (imageRate * 15);

  // 3. Penalty for item count anomalies (if baseline exists)
  const baseline = options.itemCountBaseline || total;
  if (baseline > 5 && total < (baseline * 0.25)) {
    weightedScore *= 0.7; // 30% penalty for sharp volume drop
  }

  const finalScore = Math.min(Math.max(Math.round(weightedScore), 0), 100);

  let healthStatus = 'healthy';
  if (finalScore < 60) healthStatus = 'failing';
  else if (finalScore < 85) healthStatus = 'degraded';

  return {
    healthScore: finalScore,
    status: healthStatus,
    itemCount: total,
    fieldHealth: {
      title: Number(titleRate.toFixed(2)),
      link: Number(linkRate.toFixed(2)),
      date: Number(dateRate.toFixed(2)),
      image: Number(imageRate.toFixed(2))
    }
  };
}

/**
 * Saves feed health metrics into D1 database
 */
export async function recordFeedHealth(env, sourceId, healthResult) {
  if (!env || !env.DB || !sourceId) return;

  const now = Date.now();
  const fieldHealthJson = JSON.stringify(healthResult.fieldHealth || {});
  const score = healthResult.healthScore ?? 100;
  const count = healthResult.itemCount || 0;

  try {
    await env.DB.prepare(`
      INSERT INTO feed_health_metrics (
        source_id, health_score, field_health_json, item_count_baseline, last_item_count, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        health_score = excluded.health_score,
        field_health_json = excluded.field_health_json,
        last_item_count = excluded.last_item_count,
        recorded_at = excluded.recorded_at
    `).bind(sourceId, score, fieldHealthJson, count, count, now).run();
  } catch (err) {
    console.warn('Failed to record feed health metrics:', err.message);
  }
}

/**
 * Fetches feed health metrics from D1 database
 */
export async function getFeedHealth(env, sourceId) {
  if (!env || !env.DB || !sourceId) return null;

  try {
    const row = await env.DB.prepare(`
      SELECT health_score, field_health_json, item_count_baseline, last_item_count, last_drift_detected_at, last_healed_at, recorded_at
      FROM feed_health_metrics
      WHERE source_id = ?
    `).bind(sourceId).first();

    if (!row) return null;

    let fieldHealth = {};
    try { fieldHealth = JSON.parse(row.field_health_json || '{}'); } catch (_) {}

    return {
      healthScore: row.health_score,
      fieldHealth: fieldHealth,
      itemCountBaseline: row.item_count_baseline,
      lastItemCount: row.last_item_count,
      lastDriftDetectedAt: row.last_drift_detected_at,
      lastHealedAt: row.last_healed_at,
      recordedAt: row.recorded_at
    };
  } catch (err) {
    console.warn('Failed to get feed health:', err.message);
    return null;
  }
}
