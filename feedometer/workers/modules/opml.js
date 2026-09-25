/**
 * workers/modules/opml.js — OPML 2.0 Import and Export Module
 * High-performance edge endpoint handlers for Cloudflare Workers & D1.
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { parseOpml, generateOpml } from '../services/opml-engine.js';

/**
 * GET /api/opml/export — Export all user subscriptions and folders as OPML 2.0 file
 */
export async function handleExportOpml(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    // 1. Fetch user info
    let ownerName = 'FeedOmeter User';
    try {
      const user = await env.DB.prepare('SELECT display_name, first_name, email FROM users WHERE id = ?')
        .bind(session.userId).first();
      if (user) {
        ownerName = user.display_name || user.first_name || (user.email ? user.email.split('@')[0] : 'FeedOmeter User');
      }
    } catch (_) {}

    // 2. Fetch user folders
    const foldersRes = await env.DB.prepare(`
      SELECT id, name, icon, sort_order
      FROM folders
      WHERE user_id = ?
      ORDER BY sort_order ASC, name ASC
    `).bind(session.userId).all();

    // 3. Fetch user subscriptions
    const subsRes = await env.DB.prepare(`
      SELECT 
        uf.id AS subscription_id,
        s.id AS source_id,
        s.title,
        s.feed_url,
        s.website_url,
        s.category,
        s.source_type
      FROM user_feeds uf
      JOIN sources s ON uf.source_id = s.id
      WHERE uf.user_id = ?
      ORDER BY s.title ASC
    `).bind(session.userId).all();

    // 4. Fetch user feed assignments
    const assignRes = await env.DB.prepare(`
      SELECT folder_id, feed_id
      FROM user_feed_assignments
      WHERE user_id = ?
    `).bind(session.userId).all();

    // 5. Generate OPML 2.0 XML
    const opmlXml = generateOpml({
      title: `${ownerName}'s Feedometer Subscriptions`,
      ownerName: ownerName,
      folders: foldersRes.results || [],
      subscriptions: subsRes.results || [],
      assignments: assignRes.results || []
    });

    const filenameDate = new Date().toISOString().slice(0, 10);
    const filename = `feedometer-subscriptions-${filenameDate}.opml`;

    return new Response(opmlXml, {
      status: 200,
      headers: {
        'Content-Type': 'text/x-opml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (err) {
    console.error('Export OPML error:', err.message);
    return errorResponse(`Failed to export OPML: ${err.message}`, 500);
  }
}

/**
 * POST /api/opml/import — Parse and import OPML 2.0 subscriptions into D1
 */
export async function handleImportOpml(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    let opmlText = '';
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') || formData.get('opml');
      if (file && typeof file.text === 'function') {
        opmlText = await file.text();
      } else if (typeof file === 'string') {
        opmlText = file;
      } else {
        const textParam = formData.get('opml_text');
        if (textParam) opmlText = String(textParam);
      }
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      opmlText = body.opml_text || body.opml || body.xml || '';
    } else {
      // Raw XML / OPML string payload
      opmlText = await request.text();
    }

    if (!opmlText || !opmlText.trim()) {
      return errorResponse('OPML payload is empty. Please provide a valid OPML XML file or text.', 400);
    }

    // Parse OPML structure
    const parsed = parseOpml(opmlText);
    if (!parsed || parsed.totalFeeds === 0) {
      return errorResponse('No valid RSS/Atom feed subscriptions found in OPML.', 400);
    }

    const now = Date.now();

    // 1. Fetch existing folders for user
    const existingFoldersRes = await env.DB.prepare(`
      SELECT id, name FROM folders WHERE user_id = ?
    `).bind(session.userId).all();

    const folderMap = new Map(); // lowercase name -> folder_id
    for (const f of existingFoldersRes.results || []) {
      folderMap.set(f.name.toLowerCase().trim(), f.id);
    }

    let foldersCreated = 0;
    const folderCreationStatements = [];

    // Create folders that don't exist yet
    for (const folder of parsed.folders) {
      const lowerName = folder.name.toLowerCase().trim();
      if (!folderMap.has(lowerName)) {
        const newFolderId = `fld_${generateRandomHex(12)}`;
        folderMap.set(lowerName, newFolderId);
        foldersCreated++;

        folderCreationStatements.push(
          env.DB.prepare(`
            INSERT INTO folders (id, user_id, name, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).bind(newFolderId, session.userId, folder.name.trim(), 0, now)
        );
      }
    }

    if (folderCreationStatements.length > 0) {
      await env.DB.batch(folderCreationStatements);
    }

    // 2. Process all feeds (both foldered and root feeds)
    const allFeeds = [];
    for (const folder of parsed.folders) {
      const folderId = folderMap.get(folder.name.toLowerCase().trim());
      for (const feed of folder.feeds) {
        allFeeds.push({ ...feed, folderId });
      }
    }
    for (const feed of parsed.rootFeeds) {
      allFeeds.push({ ...feed, folderId: null });
    }

    // 3. Batch insert sources, subscriptions, and folder assignments
    let subscriptionsCreated = 0;
    let assignmentsCreated = 0;
    let duplicateSkipped = 0;

    // Fetch existing user subscriptions to count duplicates
    const existingSubsRes = await env.DB.prepare(`
      SELECT uf.source_id, s.feed_url 
      FROM user_feeds uf
      JOIN sources s ON uf.source_id = s.id
      WHERE uf.user_id = ?
    `).bind(session.userId).all();

    const existingUserFeedUrls = new Set(
      (existingSubsRes.results || []).map(r => r.feed_url.toLowerCase().trim())
    );

    const statements = [];

    for (const item of allFeeds) {
      const feedUrl = (item.feedUrl || '').trim();
      if (!feedUrl || !feedUrl.startsWith('http')) continue;

      const lowerUrl = feedUrl.toLowerCase();
      if (existingUserFeedUrls.has(lowerUrl)) {
        duplicateSkipped++;
        // If assigned to a folder, ensure assignment exists
        if (item.folderId) {
          const sub = (existingSubsRes.results || []).find(r => r.feed_url.toLowerCase().trim() === lowerUrl);
          if (sub) {
            const assignId = `ufa_${generateRandomHex(12)}`;
            statements.push(
              env.DB.prepare(`
                INSERT OR IGNORE INTO user_feed_assignments (id, user_id, feed_id, folder_id, assigned_at)
                VALUES (?, ?, ?, ?, ?)
              `).bind(assignId, session.userId, sub.source_id, item.folderId, now)
            );
          }
        }
        continue;
      }

      // Mark URL as seen in this import batch
      existingUserFeedUrls.add(lowerUrl);
      subscriptionsCreated++;

      const sourceId = `src_${generateRandomHex(12)}`;
      const subId = `uf_${generateRandomHex(12)}`;
      const assignId = `ufa_${generateRandomHex(12)}`;
      const title = item.title || 'RSS Feed';
      const category = item.category || 'General';
      const sourceType = item.sourceType || 'rss';
      const websiteUrl = item.websiteUrl || '';

      // Upsert source into master catalog
      statements.push(
        env.DB.prepare(`
          INSERT INTO sources (id, title, feed_url, website_url, category, source_type, status)
          VALUES (?, ?, ?, ?, ?, ?, 'active')
          ON CONFLICT(feed_url) DO UPDATE SET title = excluded.title
        `).bind(sourceId, title, feedUrl, websiteUrl, category, sourceType)
      );

      // Add subscription into user_feeds linked by feed_url
      statements.push(
        env.DB.prepare(`
          INSERT OR IGNORE INTO user_feeds (id, user_id, source_id, followed_at)
          VALUES (?, ?, (SELECT id FROM sources WHERE feed_url = ?), ?)
        `).bind(subId, session.userId, feedUrl, now)
      );

      // If folder assigned, create folder assignment
      if (item.folderId) {
        assignmentsCreated++;
        statements.push(
          env.DB.prepare(`
            INSERT OR IGNORE INTO user_feed_assignments (id, user_id, feed_id, folder_id, assigned_at)
            VALUES (?, ?, (SELECT id FROM sources WHERE feed_url = ?), ?, ?)
          `).bind(assignId, session.userId, feedUrl, item.folderId, now)
        );
      }
    }

    // Execute in chunks of 60 statements to avoid D1 batch overhead
    const CHUNK_SIZE = 60;
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      const chunk = statements.slice(i, i + CHUNK_SIZE);
      if (chunk.length > 0) {
        await env.DB.batch(chunk);
      }
    }

    // Audit log
    await env.DB.prepare(`
      INSERT INTO user_audit_logs (id, user_id, event_type, metadata, ip_address, created_at)
      VALUES (?, ?, 'opml_import', '{"status":"success"}', 'edge', ?)
    `).bind(`aud_${generateRandomHex(12)}`, session.userId, now).run().catch(() => {});

    return jsonResponse({
      status: 'success',
      message: 'OPML imported successfully',
      stats: {
        total_found: parsed.totalFeeds,
        folders_created: foldersCreated,
        subscriptions_created: subscriptionsCreated,
        assignments_created: assignmentsCreated,
        duplicates_skipped: duplicateSkipped,
        errors: 0
      }
    });

  } catch (err) {
    console.error('Import OPML error:', err.message);
    return errorResponse(`Failed to import OPML: ${err.message}`, 500);
  }
}
