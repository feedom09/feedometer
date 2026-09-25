/**
 * workers/modules/articles.js — Normalized Content Catalog & User Action Pointers
 * Cloudflare D1 Relational Engine
 *
 * Handles HTTP requests for starring, saving, and reading articles.
 * Business logic delegated to:
 *   - services/metadata-scraper.js (HTML & OpenGraph extraction)
 *   - services/article-repository.js (D1 persistence, hydration & canonical identity)
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import {
  resolveCatalogArticleId,
  recordArticleEvent,
  hydrateAndPersist
} from '../services/article-repository.js';

export {
  ensureArticleInCatalog,
  resolveCatalogArticleId,
  hydrateCatalogItem,
  hydrateAndPersist,
  hostToSourceId
} from '../services/article-repository.js';
export { fetchPageMetadata, pickMetaContent, decodeEntities } from '../services/metadata-scraper.js';

export async function handleStarArticle(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const articleId = await resolveCatalogArticleId(env, body);

    if (!articleId) return errorResponse('Valid article URL is required to star', 400);

    const starId = `star_${generateRandomHex(12)}`;
    const now = Date.now();

    await env.DB.prepare(`
      INSERT INTO starred_articles (id, user_id, article_id, starred_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, article_id) DO NOTHING
    `).bind(starId, session.userId, articleId, now).run();

    await recordArticleEvent(env, session.userId, body.source_id, articleId, 'STAR', request);

    return jsonResponse({ status: 'success', message: 'Article starred', article_id: articleId });
  } catch (err) {
    console.error('Star article error:', err.message);
    return errorResponse('Failed to star article: ' + err.message, 500);
  }
}

export async function handleUnstarArticle(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const articleId = await resolveCatalogArticleId(env, body);

    if (!articleId) return errorResponse('Article identifier required', 400);

    await env.DB.prepare('DELETE FROM starred_articles WHERE user_id = ? AND article_id = ?')
      .bind(session.userId, articleId).run();

    return jsonResponse({ status: 'success', message: 'Article unstarred' });
  } catch (err) {
    console.error('Unstar article error:', err.message);
    return errorResponse('Failed to unstar article', 500);
  }
}

export async function handleSaveArticle(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const articleId = await resolveCatalogArticleId(env, body);

    if (!articleId) return errorResponse('Valid article URL is required to save', 400);

    const saveId = `sav_${generateRandomHex(12)}`;
    const now = Date.now();

    await env.DB.prepare(`
      INSERT INTO saved_articles (id, user_id, article_id, saved_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, article_id) DO NOTHING
    `).bind(saveId, session.userId, articleId, now).run();

    await recordArticleEvent(env, session.userId, body.source_id, articleId, 'SAVE', request);

    return jsonResponse({ status: 'success', message: 'Article saved for later', article_id: articleId });
  } catch (err) {
    console.error('Save article error:', err.message);
    return errorResponse('Failed to save article: ' + err.message, 500);
  }
}

export async function handleUnsaveArticle(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const articleId = await resolveCatalogArticleId(env, body);

    if (!articleId) return errorResponse('Article identifier required', 400);

    await env.DB.prepare('DELETE FROM saved_articles WHERE user_id = ? AND article_id = ?')
      .bind(session.userId, articleId).run();

    return jsonResponse({ status: 'success', message: 'Article removed from saved' });
  } catch (err) {
    console.error('Unsave article error:', err.message);
    return errorResponse('Failed to unsave article', 500);
  }
}

export async function handleReadArticle(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const articleId = await resolveCatalogArticleId(env, body);

    if (!articleId) return errorResponse('Valid article URL is required', 400);

    const readId = `read_${generateRandomHex(12)}`;
    const now = Date.now();

    await env.DB.prepare(`
      INSERT INTO read_history (id, user_id, article_id, read_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, article_id) DO UPDATE SET read_at = excluded.read_at
    `).bind(readId, session.userId, articleId, now).run();

    await recordArticleEvent(env, session.userId, body.source_id, articleId, 'READ_COMPLETE', request);

    return jsonResponse({ status: 'success', message: 'Article marked as read' });
  } catch (err) {
    console.error('Read article error:', err.message);
    return errorResponse('Failed to mark article as read', 500);
  }
}

export async function handleListStarred(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT a.id, a.canonical_url_hash, a.title, a.url, a.author, a.snippet, a.content,
             a.image_url, a.published_at, s.title as source_title, s.logo_url as source_logo,
             sa.starred_at, 1 as is_starred
      FROM starred_articles sa
      JOIN articles a ON sa.article_id = a.id
      LEFT JOIN sources s ON a.source_id = s.id
      WHERE sa.user_id = ?
      ORDER BY sa.starred_at DESC
      LIMIT 100
    `).bind(session.userId).all();

    const items = await Promise.all((rows.results || []).map((row) => hydrateAndPersist(env, row)));
    return jsonResponse({ status: 'success', count: items.length, items: items });
  } catch (err) {
    console.error('List starred error:', err.message);
    return errorResponse('Failed to list starred articles', 500);
  }
}

export async function handleListSaved(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT a.id, a.canonical_url_hash, a.title, a.url, a.author, a.snippet, a.content,
             a.image_url, a.published_at, s.title as source_title, s.logo_url as source_logo,
             sva.saved_at, 1 as is_saved
      FROM saved_articles sva
      JOIN articles a ON sva.article_id = a.id
      LEFT JOIN sources s ON a.source_id = s.id
      WHERE sva.user_id = ?
      ORDER BY sva.saved_at DESC
      LIMIT 100
    `).bind(session.userId).all();

    const items = await Promise.all((rows.results || []).map((row) => hydrateAndPersist(env, row)));
    return jsonResponse({ status: 'success', count: items.length, items: items });
  } catch (err) {
    console.error('List saved error:', err.message);
    return errorResponse('Failed to list saved articles', 500);
  }
}
