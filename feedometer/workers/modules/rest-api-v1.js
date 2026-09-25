/**
 * workers/modules/rest-api-v1.js — FeedOmeter Public & User REST API v1 Handlers
 * 
 * Provides cursor-paginated endpoints for articles, search, sources, subscriptions, and live OPML export.
 * Authenticated via Edge API Key middleware (`workers/middleware/api-key-auth.js`).
 */
import { verifyApiKey } from '../middleware/api-key-auth.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { generateOpml } from '../services/opml-engine.js';

/**
 * Encodes cursor from published timestamp and unique article ID
 * @param {number} publishedAt - Unix timestamp in ms
 * @param {string} id - Article unique ID
 * @returns {string} Base64 encoded cursor token
 */
export function encodeCursor(publishedAt, id) {
  return btoa(`${publishedAt}::${id}`);
}

/**
 * Decodes base64 cursor token
 * @param {string|null} cursorStr - Base64 encoded cursor token
 * @returns {{ publishedAt: number, id: string }|null} Decoded cursor components or null
 */
export function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const decoded = atob(cursorStr);
    const parts = decoded.split('::');
    if (parts.length === 2) {
      const publishedAt = parseInt(parts[0], 10);
      if (!isNaN(publishedAt)) {
        return { publishedAt, id: parts[1] };
      }
    }
  } catch (_) {}
  return null;
}

/**
 * GET /api/v1/articles — Cursor-paginated real-time article stream
 * 
 * Query Params:
 *  - limit: number (default 50, max 100)
 *  - cursor: string (opaque base64 cursor from previous page)
 *  - source_id: string (filter by specific feed source)
 *  - category: string (filter by source category)
 *  - since: number (unix timestamp ms to fetch articles after)
 */
export async function handleGetArticles(request, env) {
  const auth = await verifyApiKey(request, env, 'read:articles');
  if (!auth.valid) return errorResponse(auth.error, auth.status || 401);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100);
  const cursorToken = url.searchParams.get('cursor');
  const sourceId = url.searchParams.get('source_id');
  const category = url.searchParams.get('category');
  const since = parseInt(url.searchParams.get('since') || '0', 10);

  const cursor = decodeCursor(cursorToken);

  let query = `
    SELECT 
      a.id, 
      a.title, 
      a.url, 
      a.author, 
      a.snippet, 
      a.image_url, 
      a.published_at, 
      a.ingested_at,
      s.id AS source_id,
      s.title AS source_title,
      s.website_url AS source_website,
      s.category AS source_category,
      s.logo_url AS source_logo
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (sourceId) {
    query += ' AND a.source_id = ?';
    params.push(sourceId);
  }

  if (category) {
    query += ' AND s.category = ?';
    params.push(category);
  }

  if (since > 0) {
    query += ' AND a.published_at > ?';
    params.push(since);
  }

  if (cursor) {
    query += ' AND (a.published_at < ? OR (a.published_at = ? AND a.id < ?))';
    params.push(cursor.publishedAt, cursor.publishedAt, cursor.id);
  }

  // Fetch limit + 1 to check if another page exists
  query += ' ORDER BY a.published_at DESC, a.id DESC LIMIT ?';
  params.push(limit + 1);

  try {
    const res = await env.DB.prepare(query).bind(...params).all();
    const rows = res.results || [];
    const hasMore = rows.length > limit;
    const articles = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor = null;
    if (hasMore && articles.length > 0) {
      const last = articles[articles.length - 1];
      nextCursor = encodeCursor(last.published_at, last.id);
    }

    return jsonResponse({
      status: 'success',
      data: articles,
      pagination: {
        limit,
        count: articles.length,
        has_more: hasMore,
        next_cursor: nextCursor
      }
    });
  } catch (err) {
    return errorResponse(`Failed to query articles: ${err.message}`, 500);
  }
}

/**
 * GET /api/v1/search — Full-text article & headline search
 * 
 * Query Params:
 *  - q: string (search keyword)
 *  - limit: number (default 25, max 100)
 *  - cursor: string
 */
export async function handleSearchArticles(request, env) {
  const auth = await verifyApiKey(request, env, 'read:search');
  if (!auth.valid) return errorResponse(auth.error, auth.status || 401);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '25', 10), 1), 100);
  const cursor = decodeCursor(url.searchParams.get('cursor'));

  if (!q) {
    return errorResponse('Missing required search query parameter "q"', 400);
  }

  let query = `
    SELECT 
      a.id, 
      a.title, 
      a.url, 
      a.author, 
      a.snippet, 
      a.image_url, 
      a.published_at,
      s.id AS source_id,
      s.title AS source_title,
      s.category AS source_category
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    WHERE (a.title LIKE ? OR a.snippet LIKE ?)
  `;
  const searchPattern = `%${q}%`;
  const params = [searchPattern, searchPattern];

  if (cursor) {
    query += ' AND (a.published_at < ? OR (a.published_at = ? AND a.id < ?))';
    params.push(cursor.publishedAt, cursor.publishedAt, cursor.id);
  }

  query += ' ORDER BY a.published_at DESC, a.id DESC LIMIT ?';
  params.push(limit + 1);

  try {
    const res = await env.DB.prepare(query).bind(...params).all();
    const rows = res.results || [];
    const hasMore = rows.length > limit;
    const articles = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor = null;
    if (hasMore && articles.length > 0) {
      const last = articles[articles.length - 1];
      nextCursor = encodeCursor(last.published_at, last.id);
    }

    return jsonResponse({
      status: 'success',
      query: q,
      data: articles,
      pagination: {
        limit,
        count: articles.length,
        has_more: hasMore,
        next_cursor: nextCursor
      }
    });
  } catch (err) {
    return errorResponse(`Failed to execute search: ${err.message}`, 500);
  }
}

/**
 * GET /api/v1/sources — List global feed catalog sources
 * 
 * Query Params:
 *  - category: string (optional category filter)
 *  - limit: number (default 100, max 200)
 */
export async function handleGetSources(request, env) {
  const auth = await verifyApiKey(request, env, 'read:sources');
  if (!auth.valid) return errorResponse(auth.error, auth.status || 401);

  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 200);

  let query = `
    SELECT id, title, feed_url, website_url, category, language, logo_url, is_verified, article_count, status
    FROM sources
    WHERE status = 'active'
  `;
  const params = [];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY is_verified DESC, article_count DESC, title ASC LIMIT ?';
  params.push(limit);

  try {
    const res = await env.DB.prepare(query).bind(...params).all();
    return jsonResponse({
      status: 'success',
      count: (res.results || []).length,
      data: res.results || []
    });
  } catch (err) {
    return errorResponse(`Failed to fetch sources: ${err.message}`, 500);
  }
}

/**
 * GET /api/v1/me/subscriptions — Fetch user's active subscriptions and folder organization
 */
export async function handleGetMeSubscriptions(request, env) {
  const auth = await verifyApiKey(request, env, 'read:me');
  if (!auth.valid) return errorResponse(auth.error, auth.status || 401);

  try {
    const [subsRes, foldersRes, assignRes] = await Promise.all([
      env.DB.prepare(`
        SELECT 
          uf.id AS subscription_id,
          uf.custom_title,
          uf.is_muted,
          uf.created_at AS subscribed_at,
          s.id AS source_id,
          s.title AS source_title,
          s.feed_url,
          s.website_url,
          s.category,
          s.logo_url
        FROM user_feeds uf
        JOIN sources s ON uf.source_id = s.id
        WHERE uf.user_id = ?
        ORDER BY s.title ASC
      `).bind(auth.userId).all(),

      env.DB.prepare(`
        SELECT id, name, icon, sort_order, created_at
        FROM folders
        WHERE user_id = ?
        ORDER BY sort_order ASC, name ASC
      `).bind(auth.userId).all(),

      env.DB.prepare(`
        SELECT folder_id, feed_id
        FROM user_feed_assignments
        WHERE user_id = ?
      `).bind(auth.userId).all()
    ]);

    const subscriptions = subsRes.results || [];
    const folders = foldersRes.results || [];
    const assignments = assignRes.results || [];

    // Map feeds to folder IDs
    const feedFolderMap = {};
    assignments.forEach(a => {
      feedFolderMap[a.feed_id] = a.folder_id;
    });

    const enrichedSubscriptions = subscriptions.map(sub => ({
      ...sub,
      folder_id: feedFolderMap[sub.source_id] || null
    }));

    return jsonResponse({
      status: 'success',
      user_id: auth.userId,
      subscriptions_count: enrichedSubscriptions.length,
      folders_count: folders.length,
      data: {
        subscriptions: enrichedSubscriptions,
        folders
      }
    });
  } catch (err) {
    return errorResponse(`Failed to load user subscriptions: ${err.message}`, 500);
  }
}

/**
 * POST /api/v1/me/subscriptions — Programmatically subscribe to a new RSS/Atom feed
 */
export async function handlePostMeSubscriptions(request, env) {
  const auth = await verifyApiKey(request, env, 'write:me');
  if (!auth.valid) return errorResponse(auth.error, auth.status || 401);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return errorResponse('Invalid JSON body', 400);
  }

  const feedUrl = (body.feed_url || body.url || '').trim();
  const folderId = body.folder_id || null;

  if (!feedUrl) {
    return errorResponse('Missing required "feed_url" parameter', 400);
  }

  try {
    // 1. Check if source exists or insert
    let source = await env.DB.prepare('SELECT id, title, feed_url FROM sources WHERE feed_url = ?')
      .bind(feedUrl).first();

    if (!source) {
      const sourceId = `src_${generateRandomHex(12)}`;
      let hostDomain = '';
      try { hostDomain = new URL(feedUrl).hostname; } catch (_) {}
      const fallbackTitle = body.title || hostDomain || 'RSS Feed';

      await env.DB.prepare(`
        INSERT INTO sources (id, publisher_domain, title, feed_url, category, created_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).bind(sourceId, hostDomain, fallbackTitle, feedUrl, body.category || 'general', Date.now()).run();

      source = { id: sourceId, title: fallbackTitle, feed_url: feedUrl };
    }

    // 2. Check if already subscribed
    const existing = await env.DB.prepare('SELECT id FROM user_feeds WHERE user_id = ? AND source_id = ?')
      .bind(auth.userId, source.id).first();

    if (existing) {
      return jsonResponse({
        status: 'success',
        message: 'Already subscribed to this source',
        subscription_id: existing.id,
        source
      });
    }

    // 3. Create subscription
    const subId = `uf_${generateRandomHex(12)}`;
    await env.DB.prepare(`
      INSERT INTO user_feeds (id, user_id, source_id, custom_title, is_muted, notify_enabled, created_at)
      VALUES (?, ?, ?, ?, 0, 1, ?)
    `).bind(subId, auth.userId, source.id, body.title || null, Date.now()).run();

    // 4. Assign folder if requested
    if (folderId) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO user_feed_assignments (user_id, folder_id, feed_id)
        VALUES (?, ?, ?)
      `).bind(auth.userId, folderId, source.id).run().catch(() => {});
    }

    return jsonResponse({
      status: 'success',
      message: 'Subscribed successfully',
      subscription_id: subId,
      source
    }, 201);
  } catch (err) {
    return errorResponse(`Failed to subscribe: ${err.message}`, 500);
  }
}

/**
 * GET /api/v1/me/folders — List user's folder hierarchy
 */
export async function handleGetMeFolders(request, env) {
  const auth = await verifyApiKey(request, env, 'read:me');
  if (!auth.valid) return errorResponse(auth.error, auth.status || 401);

  try {
    const res = await env.DB.prepare(`
      SELECT id, name, icon, sort_order, created_at
      FROM folders
      WHERE user_id = ?
      ORDER BY sort_order ASC, name ASC
    `).bind(auth.userId).all();

    return jsonResponse({
      status: 'success',
      count: (res.results || []).length,
      data: res.results || []
    });
  } catch (err) {
    return errorResponse(`Failed to load folders: ${err.message}`, 500);
  }
}

/**
 * GET /api/v1/me/opml — Stream live OPML 2.0 XML subscription backup
 */
export async function handleGetMeOpml(request, env) {
  const auth = await verifyApiKey(request, env, 'read:me');
  if (!auth.valid) return errorResponse(auth.error, auth.status || 401);

  try {
    // 1. Fetch user display name
    let ownerName = 'FeedOmeter User';
    try {
      const user = await env.DB.prepare('SELECT display_name, first_name, email FROM users WHERE id = ?')
        .bind(auth.userId).first();
      if (user) {
        ownerName = user.display_name || user.first_name || (user.email ? user.email.split('@')[0] : 'FeedOmeter User');
      }
    } catch (_) {}

    // 2. Fetch folders, subscriptions, and assignments
    const [foldersRes, subsRes, assignRes] = await Promise.all([
      env.DB.prepare('SELECT id, name, icon, sort_order FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC').bind(auth.userId).all(),
      env.DB.prepare(`
        SELECT uf.id AS subscription_id, s.id AS source_id, s.title, s.feed_url, s.website_url, s.category, s.source_type
        FROM user_feeds uf
        JOIN sources s ON uf.source_id = s.id
        WHERE uf.user_id = ?
        ORDER BY s.title ASC
      `).bind(auth.userId).all(),
      env.DB.prepare('SELECT folder_id, feed_id FROM user_feed_assignments WHERE user_id = ?').bind(auth.userId).all()
    ]);

    const folders = foldersRes.results || [];
    const subscriptions = subsRes.results || [];
    const assignments = assignRes.results || [];

    // 3. Generate OPML 2.0 XML
    const opmlXml = generateOpml({
      ownerName,
      folders,
      subscriptions,
      assignments
    });

    return new Response(opmlXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/opml+xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="feedometer_backup.opml"',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  } catch (err) {
    return errorResponse(`Failed to generate OPML export: ${err.message}`, 500);
  }
}
