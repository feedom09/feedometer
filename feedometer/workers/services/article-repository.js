/**
 * workers/services/article-repository.js — Canonical Article Identity & D1 Persistence Service
 */
import { generateRandomHex, sha256Hex } from '../lib/crypto.js';
import { canonicalizeUrl } from './article-normalizer.js';
import { pickBestArticleImage } from './feed-imaging.js';
import { decodeEntities, fetchPageMetadata } from './metadata-scraper.js';
import { ensureSourceLifecycle, recordSourceFetchLifecycle } from './source-lifecycle.js';

const MAX_PERSIST_ITEMS_PER_FEED = 40;

export async function articleCanonicalHash(url) {
  const canonical = canonicalizeUrl(url) || String(url || '').trim();
  if (!canonical) return '';
  return sha256Hex(canonical);
}

export function articleIdFromHash(hash) {
  if (!hash) return '';
  return String(hash).indexOf('art_') === 0 ? String(hash) : `art_${hash}`;
}

export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '127.0.0.1';
}

export function mergeArticlePayload(body) {
  const nested = body && body.article_data && typeof body.article_data === 'object' ? body.article_data : {};
  const merged = Object.assign({}, nested);
  const src = body || {};
  Object.keys(src).forEach((key) => {
    if (key === 'article_data') return;
    if (src[key] !== undefined && src[key] !== null && src[key] !== '') {
      merged[key] = src[key];
    }
  });
  const url = decodeEntities((merged.url || merged.link || nested.url || nested.link || '').trim());
  merged.url = url;
  merged.link = url;
  if (nested.source && nested.source.id && !merged.source_id) merged.source_id = nested.source.id;
  if (nested.source && nested.source.title && !merged.source_title) merged.source_title = nested.source.title;
  if (nested.sourceTitle && !merged.source_title) merged.source_title = nested.sourceTitle;
  return merged;
}

export function hostToSourceId(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return 'src_' + host.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
  } catch (e) {
    return '';
  }
}

export function isCatalogArticleId(id) {
  return typeof id === 'string' && id.indexOf('art_') === 0;
}

export async function ensureGeneralSource(env) {
  const id = 'src_general';
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO sources (id, title, feed_url, website_url, source_type, category, is_verified, status)
      VALUES (?, 'General Web Feeds', '', '', 'rss', 'general', 0, 'active')
    `).bind(id).run();
  } catch (e) {}
  return id;
}

export function hydrateCatalogItem(row) {
  if (!row) return row;
  // Same thumbnail rules as the live stream (workers/services/feed-imaging.js).
  if (!row.image_url) {
    row.image_url = pickBestArticleImage(row);
  }
  return row;
}

export async function hydrateAndPersist(env, row) {
  const item = hydrateCatalogItem(row);
  const needsTitle = !item.title || item.title === 'Untitled Article';
  const needsImage = !item.image_url;
  const needsSnippet = !item.snippet || !String(item.snippet).trim();
  if (!needsTitle && !needsImage && !needsSnippet) return item;
  const meta = await fetchPageMetadata(item.url);
  if (!meta) return item;
  const title = needsTitle && meta.title ? meta.title : item.title;
  const image = needsImage && meta.image_url ? meta.image_url : item.image_url;
  const snippet = needsSnippet && meta.snippet ? meta.snippet : item.snippet;
  try {
    await env.DB.prepare('UPDATE articles SET title = ?, image_url = ?, snippet = ? WHERE id = ?')
      .bind(title || item.title, image || '', snippet || '', item.id).run();
  } catch (e) {}
  item.title = title;
  item.image_url = image;
  item.snippet = snippet;
  if (meta.site_name && item.source_title === 'General Web Feeds') {
    item.source_title = meta.site_name;
  }
  return item;
}

export async function resolveSourceId(env, articleData, url) {
  let sourceId = articleData.source_id || (articleData.source && articleData.source.id) || '';
  if (sourceId) {
    const srcRow = await env.DB.prepare('SELECT id FROM sources WHERE id = ?').bind(sourceId).first();
    if (srcRow) return srcRow.id;
    sourceId = '';
  }
  if (articleData.feed_url) {
    const src = await env.DB.prepare('SELECT id FROM sources WHERE feed_url = ?').bind(articleData.feed_url).first();
    if (src) return src.id;
  }
  const derivedId = hostToSourceId(url);
  const sourceTitle = (articleData.source_title || articleData.sourceTitle || (articleData.source && articleData.source.title) || '').trim();
  if (derivedId) {
    const byId = await env.DB.prepare('SELECT id FROM sources WHERE id = ?').bind(derivedId).first();
    if (byId) return derivedId;
    try {
      const host = new URL(url).origin;
      await env.DB.prepare(`
        INSERT OR IGNORE INTO sources (id, title, feed_url, website_url, source_type, category, is_verified, status)
        VALUES (?, ?, ?, ?, 'rss', 'general', 0, 'active')
      `).bind(derivedId, sourceTitle || derivedId.replace(/^src_/, ''), url, host).run();
      return derivedId;
    } catch (e) {}
  }
  return ensureGeneralSource(env);
}

/**
 * Preserve the source-specific occurrence of an article even when its canonical
 * URL has already been catalogued from another feed. This keeps catalog identity
 * stable while making provenance available for later reader and health views.
 */
export async function recordArticleSourceAttribution(env, articleId, sourceId, articleData, url, seenAt = Date.now()) {
  if (!env || !env.DB || !articleId || !sourceId) return;
  const sourceGuid = String(articleData?.guid || articleData?.id || articleData?.source_item_guid || '').slice(0, 1000) || null;
  const sourceUrl = String(url || articleData?.url || articleData?.link || '').slice(0, 4000) || null;
  await env.DB.prepare(`
    INSERT INTO article_source_attributions (
      article_id, source_id, source_item_guid, source_article_url, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id, source_id) DO UPDATE SET
      source_item_guid = COALESCE(excluded.source_item_guid, article_source_attributions.source_item_guid),
      source_article_url = COALESCE(excluded.source_article_url, article_source_attributions.source_article_url),
      last_seen_at = excluded.last_seen_at
  `).bind(articleId, sourceId, sourceGuid, sourceUrl, seenAt, seenAt).run();
}

export async function ensureArticleInCatalog(env, articleData) {
  if (!articleData) return null;
  const url = decodeEntities((articleData.url || articleData.link || '').trim());
  if (!url) return null;

  const canonicalHash = articleData.canonical_url_hash || await articleCanonicalHash(url);
  let title = String(articleData.title || '').trim();
  let imageUrl = pickBestArticleImage(articleData);
  let snippet = String(articleData.snippet || articleData.summary || articleData.description || '').slice(0, 4000);
  const content = String(articleData.content || '').slice(0, 20000);
  if (!title || title === 'Untitled Article' || !imageUrl) {
    const meta = await fetchPageMetadata(url);
    if (meta) {
      if (!title || title === 'Untitled Article') title = meta.title || title;
      if (!imageUrl) imageUrl = meta.image_url || '';
      if (!snippet) snippet = (meta.snippet || '').slice(0, 4000);
      if (meta.site_name && !articleData.source_title) articleData.source_title = meta.site_name;
    }
  }

  const sourceId = await resolveSourceId(env, articleData, url);
  const existing = await env.DB.prepare('SELECT id, title, image_url, snippet FROM articles WHERE canonical_url_hash = ?').bind(canonicalHash).first();
  if (existing) {
    const nextTitle = (!existing.title || existing.title === 'Untitled Article') && title ? title : existing.title;
    const nextImage = (!existing.image_url && imageUrl) ? imageUrl : existing.image_url;
    const nextSnippet = (!existing.snippet && snippet) ? snippet : existing.snippet;
    if (nextTitle !== existing.title || nextImage !== existing.image_url || nextSnippet !== existing.snippet) {
      await env.DB.prepare(`
        UPDATE articles SET title = ?, image_url = ?, snippet = ? WHERE id = ?
      `).bind(nextTitle || existing.title, nextImage || '', nextSnippet || '', existing.id).run();
    }
    await recordArticleSourceAttribution(env, existing.id, sourceId, articleData, url);
    return existing.id;
  }

  const articleId = articleIdFromHash(canonicalHash);
  const now = Date.now();
  let publishedAt = now;
  const rawPub = articleData.published_at || articleData.published || articleData.pubDate;
  if (rawPub) {
    const parsed = new Date(rawPub).getTime();
    if (!Number.isNaN(parsed)) publishedAt = parsed;
  }

  await env.DB.prepare(`
    INSERT INTO articles (id, canonical_url_hash, source_id, title, url, author, snippet, content, image_url, published_at, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_url_hash) DO UPDATE SET
      title = CASE WHEN articles.title = 'Untitled Article' AND excluded.title != '' THEN excluded.title ELSE articles.title END,
      image_url = CASE WHEN (articles.image_url IS NULL OR articles.image_url = '') THEN excluded.image_url ELSE articles.image_url END,
      snippet = CASE WHEN (articles.snippet IS NULL OR articles.snippet = '') THEN excluded.snippet ELSE articles.snippet END,
      content = CASE WHEN (articles.content IS NULL OR articles.content = '') THEN excluded.content ELSE articles.content END
  `).bind(
    articleId,
    canonicalHash,
    sourceId,
    title || 'Untitled Article',
    url,
    articleData.author || articleData.creator || '',
    snippet,
    content,
    imageUrl,
    publishedAt,
    now
  ).run();

  const final = await env.DB.prepare('SELECT id FROM articles WHERE canonical_url_hash = ?').bind(canonicalHash).first();
  const finalId = final ? final.id : articleId;
  await recordArticleSourceAttribution(env, finalId, sourceId, articleData, url, now);
  return finalId;
}

export async function resolveCatalogArticleId(env, body) {
  const payload = mergeArticlePayload(body);
  if (payload.url) {
    const catalogId = await ensureArticleInCatalog(env, payload);
    if (catalogId) return catalogId;
  }
  if (isCatalogArticleId(payload.article_id)) {
    const row = await env.DB.prepare('SELECT id FROM articles WHERE id = ?').bind(payload.article_id).first();
    if (row) return row.id;
  }
  return null;
}

export async function ensureSourceRow(env, source) {
  if (!env || !env.DB || !source) return null;
  const feedUrl = String(source.feed_url || '').trim();
  if (!feedUrl) return source.id || null;

  try {
    const existing = await env.DB.prepare('SELECT id FROM sources WHERE feed_url = ?').bind(feedUrl).first();
    if (existing && existing.id) {
      await ensureSourceLifecycle(env, existing.id, 'pending');
      return existing.id;
    }
  } catch (e) {}

  let id = String(source.id || '').trim();
  if (!id || id.indexOf('src_custom_') === 0 || id === 'unknown') {
    id = hostToSourceId(feedUrl) || ('src_' + generateRandomHex(8));
  }

  const title = String(source.title || 'Feed Source').slice(0, 200);
  let websiteUrl = String(source.website_url || '').trim();
  if (!websiteUrl) {
    try { websiteUrl = new URL(feedUrl).origin; } catch (e) { websiteUrl = ''; }
  }
  const category = String(source.category || 'general').slice(0, 80);

  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO sources (id, title, feed_url, website_url, source_type, category, is_verified, status)
      VALUES (?, ?, ?, ?, 'rss', ?, 0, 'active')
    `).bind(id, title, feedUrl, websiteUrl, category).run();
    const row = await env.DB.prepare('SELECT id FROM sources WHERE feed_url = ?').bind(feedUrl).first();
    const sourceId = row && row.id ? row.id : id;
    await ensureSourceLifecycle(env, sourceId, 'pending');
    return sourceId;
  } catch (e) {
    console.warn('ensureSourceRow failed:', e.message);
    return id;
  }
}

async function persistNormalizedItems(env, sourceId, source, items, fetchSucceeded = true) {
  const list = Array.isArray(items) ? items.slice(0, MAX_PERSIST_ITEMS_PER_FEED) : [];
  if (!sourceId || !list.length) return 0;

  const now = Date.now();
  const statements = [];
  let latestPublished = 0;

  for (const item of list) {
    const url = decodeEntities((item.url || item.link || '').trim());
    if (!url) continue;
    const canonicalHash = item.canonical_url_hash || await articleCanonicalHash(url);
    if (!canonicalHash) continue;
    const articleId = articleIdFromHash(canonicalHash);
    const title = String(item.title || 'Untitled Article').slice(0, 500);
    const snippet = String(item.summary || item.snippet || item.description || '').slice(0, 4000);
    const imageUrl = pickBestArticleImage(item) || item.image_url || item.image || '';
    const author = String(item.author || '').slice(0, 200);
    let publishedAt = now;
    const rawPub = item.published_at || item.published || item.pubDate || item.publishedAt;
    if (rawPub) {
      const parsed = new Date(rawPub).getTime();
      if (!Number.isNaN(parsed)) publishedAt = parsed;
    }
    if (publishedAt > latestPublished) latestPublished = publishedAt;

    statements.push(
      env.DB.prepare(`
        INSERT INTO articles (id, canonical_url_hash, source_id, title, url, author, snippet, content, image_url, published_at, ingested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_url_hash) DO UPDATE SET
          title = CASE WHEN articles.title = 'Untitled Article' AND excluded.title != '' THEN excluded.title ELSE articles.title END,
          image_url = CASE WHEN (articles.image_url IS NULL OR articles.image_url = '') THEN excluded.image_url ELSE articles.image_url END,
          snippet = CASE WHEN (articles.snippet IS NULL OR articles.snippet = '') THEN excluded.snippet ELSE articles.snippet END
      `).bind(
        articleId,
        canonicalHash,
        sourceId,
        title,
        url,
        author,
        snippet,
        '',
        imageUrl,
        publishedAt,
        now
      )
    );

    statements.push(
      env.DB.prepare(`
        INSERT INTO article_source_attributions (
          article_id, source_id, source_item_guid, source_article_url, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(article_id, source_id) DO UPDATE SET
          source_item_guid = COALESCE(excluded.source_item_guid, article_source_attributions.source_item_guid),
          source_article_url = COALESCE(excluded.source_article_url, article_source_attributions.source_article_url),
          last_seen_at = excluded.last_seen_at
      `).bind(
        articleId,
        sourceId,
        String(item.guid || item.id || '').slice(0, 1000) || null,
        url.slice(0, 4000) || null,
        now,
        now
      )
    );

    // Queue event into feed_events queue
    const eventId = `fev_${generateRandomHex(12)}`;
    statements.push(
      env.DB.prepare(`
        INSERT OR IGNORE INTO feed_events (id, article_id, source_id, event_type, status, locked_until, retry_count, created_at)
        VALUES (?, ?, ?, 'ARTICLE_INGESTED', 'pending', 0, 0, ?)
      `).bind(eventId, articleId, sourceId, now)
    );
  }

  statements.push(
    env.DB.prepare(`
      UPDATE sources
      SET last_polled_at = CASE WHEN ? THEN ? ELSE last_polled_at END,
          last_article_at = CASE WHEN ? AND ? IS NOT NULL THEN ? ELSE last_article_at END
      WHERE id = ?
    `).bind(
      fetchSucceeded ? 1 : 0, now,
      fetchSucceeded ? 1 : 0, latestPublished || null, latestPublished || null,
      sourceId
    )
  );

  if (typeof env.DB.batch === 'function') {
    await env.DB.batch(statements);
  } else {
    for (const stmt of statements) {
      await stmt.run();
    }
  }
  try {
    for (const item of list.slice(0, 15)) {
      const url = decodeEntities((item.url || item.link || '').trim());
      if (!url) continue;
      const canonicalHash = item.canonical_url_hash || await articleCanonicalHash(url);
      await env.DB.prepare(`
        INSERT INTO article_search (article_id, published_at, language, title, author, snippet, source_name, category)
        VALUES (?, ?, 'en', ?, ?, ?, ?, ?)
      `).bind(
        articleIdFromHash(canonicalHash),
        Date.now(),
        String(item.title || '').slice(0, 500),
        String(item.author || ''),
        String(item.summary || item.snippet || '').slice(0, 1000),
        String((source && source.title) || ''),
        String((source && source.category) || 'general')
      ).run();
    }
  } catch (e) {}
  return list.length;
}

async function writeSourceHealth(env, sourceId, metrics) {
  if (!env.DB || !sourceId) return;
  const isSuccess = !!metrics.isSuccess;
  const now = Date.now();
  const httpStatus = metrics.httpStatus || 0;
  const responseMs = metrics.responseMs || 0;
  const errorMessage = metrics.errorMessage || null;

  await env.DB.prepare(`
    INSERT INTO source_health (
      source_id, last_success_at, last_failure_at, consecutive_failures, last_http_status, response_ms, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
      last_failure_at = CASE WHEN ? THEN last_failure_at ELSE ? END,
      consecutive_failures = CASE WHEN ? THEN 0 ELSE consecutive_failures + 1 END,
      last_http_status = ?,
      response_ms = ?,
      error_message = ?
  `).bind(
    sourceId,
    isSuccess ? now : null,
    isSuccess ? null : now,
    isSuccess ? 0 : 1,
    httpStatus,
    responseMs,
    errorMessage,
    isSuccess ? 1 : 0, now,
    isSuccess ? 1 : 0, now,
    isSuccess ? 1 : 0,
    httpStatus,
    responseMs,
    errorMessage
  ).run();
}

/**
 * Upsert the feed into sources, persist normalized items into articles, then record source_health.
 * Safe to run inside ctx.waitUntil — does not scrape OG (stream stays fast).
 */
export async function persistFetchedFeed(env, source, payload, metrics = {}) {
  if (!env || !env.DB || !source) return { source_id: null, persisted: 0 };
  const sourceId = await ensureSourceRow(env, {
    id: (payload && payload.source && payload.source.id) || source.id,
    title: (payload && payload.source && payload.source.title) || source.title,
    feed_url: source.feed_url || (payload && payload.source && payload.source.feed_url),
    website_url: source.website_url || (payload && payload.source && payload.source.website_url),
    category: source.category || (payload && payload.source && payload.source.category)
  });
  const items = (payload && payload.items) || [];
  let persisted = 0;
  try {
    persisted = await persistNormalizedItems(env, sourceId, source, items, Boolean(metrics.isSuccess));
  } catch (e) {
    console.warn('persistNormalizedItems failed:', e.message);
  }
  if (!metrics.fromCache) {
    try {
      await writeSourceHealth(env, sourceId, metrics);
    } catch (e) {
      console.warn('source_health write failed:', e.message);
    }
    try {
      await recordSourceFetchLifecycle(env, sourceId, metrics);
    } catch (e) {
      console.warn('source_lifecycle write failed:', e.message);
    }
  }
  return { source_id: sourceId, persisted };
}

export async function recordArticleEvent(env, userId, sourceId, articleId, eventType, request) {
  if (!env.DB || !articleId) return;
  try {
    const eventId = `evt_${generateRandomHex(12)}`;
    const ip = request ? getClientIp(request) : '127.0.0.1';
    await env.DB.prepare(`
      INSERT INTO article_events (id, user_id, source_id, article_id, event_type, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(eventId, userId || null, sourceId || null, articleId, eventType, ip, Date.now()).run();
  } catch (e) {
    console.error('Failed to log article event:', e.message);
  }
}
