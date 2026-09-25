/**
 * Apply persisted user_filter_rules to a fused stream.
 */
function parseList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function itemMatchesRules(item, rules) {
  if (!rules || rules.enabled === false) return true;
  const title = String(item.title || '').toLowerCase();
  const snippet = String(item.summary || item.snippet || item.description || '').toLowerCase();
  const hay = title + ' ' + snippet;
  const url = String(item.url || item.link || '').toLowerCase();
  let host = '';
  try { host = new URL(item.url || item.link || 'https://invalid.local').hostname.replace(/^www\./, ''); } catch (e) {}

  const includeKw = parseList(rules.includeKeywords);
  const excludeKw = parseList(rules.excludeKeywords);
  const includeDom = parseList(rules.includeDomains);
  const excludeDom = parseList(rules.excludeDomains);

  if (includeKw.length && !includeKw.some((k) => hay.includes(k))) return false;
  if (excludeKw.some((k) => hay.includes(k))) return false;
  if (includeDom.length && !includeDom.some((d) => host.includes(d) || url.includes(d))) return false;
  if (excludeDom.some((d) => host.includes(d) || url.includes(d))) return false;
  if (rules.noImage && !(item.image || item.image_url)) return false;
  if (rules.noDescription && !snippet.trim()) return false;
  if (rules.noSecureLink && url && !url.startsWith('https://')) return false;
  if (rules.oldPosts) {
    const days = Number(rules.oldDays) || 3;
    const published = new Date(item.published || item.published_at || 0).getTime();
    if (published && Date.now() - published > days * 86400000) return false;
  }
  return true;
}

export function applyRulesToStream(streamResult, rules) {
  if (!streamResult || !Array.isArray(streamResult.items) || !rules) return streamResult;
  const items = streamResult.items.filter((item) => itemMatchesRules(item, rules));
  return Object.assign({}, streamResult, {
    items,
    count: items.length,
    filters_applied: true
  });
}

export async function loadUserFilterRules(env, userId) {
  if (!env.DB || !userId) return null;
  try {
    const row = await env.DB.prepare('SELECT rules_json FROM user_filter_rules WHERE user_id = ?')
      .bind(userId).first();
    if (!row || !row.rules_json) return null;
    return JSON.parse(row.rules_json);
  } catch (e) {
    return null;
  }
}

export async function saveUserFilterRules(env, userId, rules) {
  const payload = JSON.stringify(rules || {});
  await env.DB.prepare(`
    INSERT INTO user_filter_rules (user_id, rules_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET rules_json = excluded.rules_json, updated_at = excluded.updated_at
  `).bind(userId, payload, Date.now()).run();
}

export async function handleGetFilters(request, env) {
  const { verifySessionToken } = await import('../lib/session.js');
  const { jsonResponse, errorResponse } = await import('../lib/response.js');
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  const rules = await loadUserFilterRules(env, session.userId);
  return jsonResponse({ status: 'success', rules: rules || {} });
}

export async function handleSaveFilters(request, env) {
  const { verifySessionToken } = await import('../lib/session.js');
  const { jsonResponse, errorResponse } = await import('../lib/response.js');
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const rules = body.rules || body;
  try {
    await saveUserFilterRules(env, session.userId, rules);
    return jsonResponse({ status: 'success', rules });
  } catch (e) {
    return errorResponse('Filter table missing. Apply schema_phase2_search.sql first.', 500);
  }
}
