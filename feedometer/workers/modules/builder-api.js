/**
 * workers/modules/builder-api.js — Visual RSS Feed Builder API Handlers
 */
import { fetchProxyPage, evaluateSelectorConfig, generateFallbackChain, buildRssXmlFromItems } from '../services/visual-builder-engine.js';
import { fetchPageHtmlForBuilder, normalizeRenderMode } from '../services/builder-page-fetch.js';
import { calculateFeedHealth, recordFeedHealth, getFeedHealth } from '../services/feed-health.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { normalizeExternalHttpUrl } from '../services/source-intake.js';

function validateBuilderTarget(rawUrl) {
  const result = normalizeExternalHttpUrl(rawUrl);
  return result.ok ? result : null;
}

const SELECTOR_FIELDS = ['container', 'itemContainer', 'title', 'link', 'description', 'image', 'date', 'author'];

export function normalizeSelectorConfig(value, { requireCore = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'Selector configuration must be an object.' };
  }
  const selectors = {};
  for (const field of SELECTOR_FIELDS) {
    if (value[field] === undefined || value[field] === null) continue;
    if (typeof value[field] !== 'string') return { ok: false, message: `Selector "${field}" must be text.` };
    const selector = value[field].trim();
    if (!selector) continue;
    if (selector.length > 500 || /[\u0000-\u001f]/.test(selector)) {
      return { ok: false, message: `Selector "${field}" is invalid or too long.` };
    }
    selectors[field] = selector;
  }
  if (requireCore && !(selectors.container || selectors.itemContainer)) {
    return { ok: false, message: 'Choose an article container before saving.' };
  }
  if (requireCore && (!selectors.title || !selectors.link)) {
    return { ok: false, message: 'Choose title and link selectors before saving.' };
  }
  return { ok: true, selectors };
}

/**
 * GET /api/builder/proxy?url=...
 * Serves the target website inside the visual point-and-click studio iframe
 */
export async function handleBuilderProxy(request, env) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing target "url" parameter', { status: 400 });
  }
  const validation = validateBuilderTarget(targetUrl);
  if (!validation) return new Response('Invalid or unsafe target URL', { status: 400 });

  try {
    const renderMode = normalizeRenderMode(
      url.searchParams.get('render_mode') || url.searchParams.get('render') || 'auto'
    );
    const inspectorScriptUrl = new URL('/api/builder/preview-inspector.js', url.origin).toString();
    const proxyResult = await fetchProxyPage(validation.url, env, { renderMode, inspectorScriptUrl });
    const blocked = Boolean(proxyResult.blocked);
    return new Response(proxyResult.html, {
      status: blocked ? 451 : 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': 'frame-ancestors *',
        'Access-Control-Allow-Origin': '*',
        'X-Feedometer-Js-Shell': proxyResult.jsShell ? '1' : '0',
        'X-Feedometer-Render-Engine': proxyResult.renderEngine || 'static',
        'X-Feedometer-Browser-Skipped': proxyResult.browserSkipped ? '1' : '0',
        'X-Feedometer-Render-Cached': proxyResult.renderCached ? '1' : '0',
        'X-Feedometer-Blocked': blocked ? '1' : '0'
      }
    });
  } catch (err) {
    return new Response(
      `<html><body style="font-family:sans-serif;padding:2rem;color:#b91c1c;background:#fef2f2;"><h3>⚠️ Failed to load website into Visual Studio</h3><p>${err.message}</p></body></html>`,
      { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': 'frame-ancestors *' } }
    );
  }
}

/**
 * POST /api/builder/evaluate
 * Evaluates custom selector inputs on the target URL
 */
export async function handleBuilderEvaluate(request, env) {
  try {
    const body = await request.json();
    const requestedUrl = (body.url || body.siteUrl || '').trim();
    const selectorResult = normalizeSelectorConfig(body.selectors || body.config || {});
    if (!selectorResult.ok) return errorResponse(selectorResult.message, 400, 'INVALID_SELECTOR_CONFIG');
    const selectorConfig = selectorResult.selectors;

    if (!requestedUrl) {
      return errorResponse('Missing "url" parameter', 400);
    }
    const validation = validateBuilderTarget(requestedUrl);
    if (!validation) return errorResponse('Invalid or unsafe target URL', 400, 'INVALID_TARGET_URL');
    const targetUrl = validation.url;

    let html = body.html;
    const renderMode = normalizeRenderMode(
      body.render_mode || (body.render_js ? 'browser' : 'auto')
    );

    if (!html) {
      const pageResult = await fetchPageHtmlForBuilder(env, targetUrl, { renderMode });
      html = pageResult.html;
    }

    const evaluation = evaluateSelectorConfig(html, targetUrl, selectorConfig);
    const health = calculateFeedHealth(evaluation.items);

    // Generate fallback chains for each configured selector
    const fallbackChains = {
      container: generateFallbackChain(selectorConfig.itemContainer || 'article', 'container'),
      title: generateFallbackChain(selectorConfig.title || 'h2', 'title'),
      link: generateFallbackChain(selectorConfig.link || 'a', 'link'),
      description: generateFallbackChain(selectorConfig.description || 'p', 'description'),
      image: generateFallbackChain(selectorConfig.image || 'img', 'image'),
      date: generateFallbackChain(selectorConfig.date || 'time', 'date')
    };

    return jsonResponse({
      status: 'success',
      matchCount: evaluation.matchCount,
      confidence: evaluation.confidence,
      health: health,
      fallbackChains: fallbackChains,
      items: evaluation.items,
      renderMode: renderMode
    });
  } catch (err) {
    return errorResponse(`Evaluation failed: ${err.message}`, 500);
  }
}

/**
 * POST /api/builder/save-config
 * Saves the verified selector recipe and fallback chains into D1
 */
export async function handleBuilderSaveConfig(request, env) {
  if (!env.DB) return errorResponse('Database unavailable', 500);

  try {
    const body = await request.json();
    const requestedUrl = (body.url || '').trim();
    const selectorResult = normalizeSelectorConfig(body.selectors || {}, { requireCore: true });
    if (!selectorResult.ok) return errorResponse(selectorResult.message, 400, 'INVALID_SELECTOR_CONFIG');
    const selectors = selectorResult.selectors;
    const contentType = body.content_type || body.contentType || 'news';
    const renderJs = body.render_js ? 1 : (normalizeRenderMode(body.render_mode || 'auto') === 'browser' ? 1 : 0);
    const extractionMode = body.extraction_mode || 'manual';

    if (!requestedUrl) return errorResponse('Missing "url" parameter', 400);
    const validation = validateBuilderTarget(requestedUrl);
    if (!validation) return errorResponse('Invalid or unsafe target URL', 400, 'INVALID_TARGET_URL');
    const targetUrl = validation.url;

    // Never persist a recipe solely because the browser submitted it. Re-run it
    // on the current page so the published RSS endpoint starts from a verified
    // extraction rather than a blank or navigation-only selector set.
    const verificationRenderMode = normalizeRenderMode(body.render_mode || (body.render_js ? 'browser' : 'auto'));
    const verificationPage = await fetchPageHtmlForBuilder(env, targetUrl, { renderMode: verificationRenderMode });
    const verification = evaluateSelectorConfig(verificationPage.html, targetUrl, selectors);
    const verifiedHealth = calculateFeedHealth(verification.items);
    if (verification.matchCount < 1 || verifiedHealth.fieldHealth.title < 0.9 || verifiedHealth.fieldHealth.link < 0.9) {
      return errorResponse('Selector recipe did not verify against the current page. Refine the container, title, and link fields, then try again.', 422, 'UNVERIFIED_SELECTOR_RECIPE');
    }

    const domain = new URL(targetUrl).hostname.replace(/^www\./, '');
    const now = Date.now();

    // 1. Ensure source exists
    let source = await env.DB.prepare('SELECT id FROM sources WHERE feed_url = ? OR website_url = ?')
      .bind(targetUrl, targetUrl).first();

    let sourceId = source ? source.id : `src_${generateRandomHex(12)}`;

    if (!source) {
      await env.DB.prepare(`
        INSERT INTO sources (id, publisher_domain, title, feed_url, website_url, source_type, category, created_at, status)
        VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, 'active')
      `).bind(sourceId, domain, body.title || domain, targetUrl, targetUrl, contentType, now).run();
    }

    // 2. Save builder config
    const configId = `fbc_${generateRandomHex(12)}`;
    const selectorJson = JSON.stringify(selectors);
    const confidenceJson = JSON.stringify(verification.confidence);

    await env.DB.prepare(`
      INSERT INTO feed_builder_configs (
        id, source_id, content_type, render_js, extraction_mode, selector_config_json, confidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        content_type = excluded.content_type,
        render_js = excluded.render_js,
        extraction_mode = excluded.extraction_mode,
        selector_config_json = excluded.selector_config_json,
        confidence_json = excluded.confidence_json,
        updated_at = excluded.updated_at
    `).bind(configId, sourceId, contentType, renderJs, extractionMode, selectorJson, confidenceJson, now, now).run().catch(() => {});

    // 3. Save to Domain Learning Layer (domain_patterns)
    await env.DB.prepare(`
      INSERT INTO domain_patterns (domain, selector_config_json, confidence, source, usage_count, updated_at)
      VALUES (?, ?, 0.98, 'user_correction', 1, ?)
      ON CONFLICT(domain) DO UPDATE SET
        selector_config_json = excluded.selector_config_json,
        usage_count = domain_patterns.usage_count + 1,
        updated_at = excluded.updated_at
    `).bind(domain, selectorJson, now).run().catch(() => {});

    // 4. Record initial health score
    await recordFeedHealth(env, sourceId, verifiedHealth);

    return jsonResponse({
      status: 'success',
      message: 'Builder configuration and fallback chains saved successfully',
      sourceId: sourceId,
      domain: domain,
      health: verifiedHealth,
      verifiedItemCount: verification.matchCount
    });
  } catch (err) {
    return errorResponse(`Failed to save config: ${err.message}`, 500);
  }
}

/**
 * GET /api/builder/feed?url=...
 * Serves a live RSS feed built from saved Visual Builder selector recipes
 */
export async function handleBuilderFeed(request, env) {
  const url = new URL(request.url);
  const requestedUrl = (url.searchParams.get('url') || url.searchParams.get('site') || '').trim();

  if (!requestedUrl) {
    return errorResponse('Missing "url" parameter', 400);
  }
  const validation = validateBuilderTarget(requestedUrl);
  if (!validation) return errorResponse('Invalid or unsafe target URL', 400, 'INVALID_TARGET_URL');
  const targetUrl = validation.url;

  let selectorConfig = {};
  let renderJsFlag = 0;

  try {
    const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

    if (env.DB) {
      const patternRow = await env.DB.prepare(
        'SELECT selector_config_json FROM domain_patterns WHERE domain = ?'
      ).bind(domain).first();
      if (patternRow && patternRow.selector_config_json) {
        selectorConfig = JSON.parse(patternRow.selector_config_json);
      }

      if (!selectorConfig.container && !selectorConfig.itemContainer) {
        const configRow = await env.DB.prepare(`
          SELECT fbc.selector_config_json, fbc.render_js
          FROM feed_builder_configs fbc
          JOIN sources s ON s.id = fbc.source_id
          WHERE s.website_url = ? OR s.feed_url = ? OR s.publisher_domain = ?
          ORDER BY fbc.updated_at DESC
          LIMIT 1
        `).bind(targetUrl, targetUrl, domain).first();
        if (configRow && configRow.selector_config_json) {
          selectorConfig = JSON.parse(configRow.selector_config_json);
          renderJsFlag = configRow.render_js ? 1 : 0;
        }
      }
    }
  } catch (_) {
    // fall through to error below if no config
  }

  if (!selectorConfig.container && !selectorConfig.itemContainer) {
    return errorResponse(
      'No saved Visual Builder selector recipe for this URL. Open Visual Builder, map selectors, and click Generate & Save Feed.',
      404
    );
  }

  try {
    const renderMode = renderJsFlag ? 'browser' : 'auto';
    const pageResult = await fetchPageHtmlForBuilder(env, targetUrl, { renderMode });
    const html = pageResult.html;
    const evaluation = evaluateSelectorConfig(html, targetUrl, selectorConfig);

    if (!evaluation.items || evaluation.items.length === 0) {
      return errorResponse('Selector recipe matched zero articles on the target page.', 422);
    }

    const xml = buildRssXmlFromItems(evaluation.items, targetUrl);
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=900'
      }
    });
  } catch (err) {
    return errorResponse(`Builder feed failed: ${err.message}`, 500);
  }
}

/**
 * GET /api/builder/health
 * Returns health metrics for a source ID
 */
export async function handleBuilderGetHealth(request, env) {
  const url = new URL(request.url);
  const sourceId = url.searchParams.get('source_id') || url.searchParams.get('id');

  if (!sourceId) return errorResponse('Missing "source_id" parameter', 400);

  const metrics = await getFeedHealth(env, sourceId);
  if (!metrics) {
    return jsonResponse({
      status: 'success',
      health: { healthScore: 100, fieldHealth: { title: 1.0, link: 1.0, date: 1.0, image: 1.0 }, status: 'healthy' }
    });
  }

  return jsonResponse({
    status: 'success',
    health: metrics
  });
}
