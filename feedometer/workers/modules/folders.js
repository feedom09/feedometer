/**
 * workers/modules/folders.js — Hierarchical Folder Taxonomy & Feed Assignments
 */
import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';

export async function handleListFolders(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const foldersResult = await env.DB.prepare(`
      SELECT 
        f.id,
        f.name,
        f.parent_folder_id,
        f.icon,
        f.sort_order,
        COUNT(ufa.id) AS feed_count
      FROM folders f
      LEFT JOIN user_feed_assignments ufa ON f.id = ufa.folder_id AND ufa.user_id = f.user_id
      WHERE f.user_id = ?
      GROUP BY f.id
      ORDER BY f.sort_order ASC, f.created_at ASC
    `).bind(session.userId).all();

    const assigned = await env.DB.prepare(`
      SELECT ufa.folder_id, s.id AS source_id, s.title, s.feed_url
      FROM user_feed_assignments ufa
      JOIN sources s ON s.id = ufa.feed_id
      WHERE ufa.user_id = ?
      ORDER BY s.title ASC
    `).bind(session.userId).all();

    const byFolder = {};
    (assigned.results || []).forEach((row) => {
      if (!byFolder[row.folder_id]) byFolder[row.folder_id] = [];
      byFolder[row.folder_id].push({
        id: row.source_id,
        title: row.title,
        feed_url: row.feed_url
      });
    });

    const folders = (foldersResult.results || []).map((f) => Object.assign({}, f, {
      feeds: byFolder[f.id] || []
    }));

    return jsonResponse({
      status: 'success',
      folders
    });
  } catch (err) {
    console.error('List folders error:', err.message);
    return errorResponse('Failed to list folders', 500);
  }
}

export async function handleCreateFolder(request, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    const icon = (body.icon || '📁').trim();
    const parentFolderId = body.parent_folder_id || null;
    const sortOrder = typeof body.sort_order === 'number' ? body.sort_order : 0;

    if (!name) {
      return errorResponse('Folder name is required', 400);
    }

    if (parentFolderId) {
      const parent = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?')
        .bind(parentFolderId, session.userId).first();
      if (!parent) {
        return errorResponse('Parent folder does not exist', 400);
      }
    }

    const folderId = `fol_${generateRandomHex(12)}`;
    await env.DB.prepare(`
      INSERT INTO folders (id, user_id, name, parent_folder_id, icon, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(folderId, session.userId, name, parentFolderId, icon, sortOrder, Date.now()).run();

    return jsonResponse({
      status: 'success',
      message: 'Folder created successfully',
      folder: {
        id: folderId,
        name,
        icon,
        parent_folder_id: parentFolderId,
        sort_order: sortOrder
      }
    }, 201);

  } catch (err) {
    console.error('Create folder error:', err.message);
    return errorResponse('Failed to create folder', 500);
  }
}

export async function handleDeleteFolder(request, folderId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const folder = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?')
      .bind(folderId, session.userId).first();

    if (!folder) {
      return errorResponse('Folder not found', 404, 'NOT_FOUND');
    }

    // Deleting the folder cascades in SQLite to subfolders and user_feed_assignments
    await env.DB.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?')
      .bind(folderId, session.userId).run();

    return jsonResponse({ status: 'success', message: 'Folder deleted successfully' });

  } catch (err) {
    console.error('Delete folder error:', err.message);
    return errorResponse('Failed to delete folder', 500);
  }
}

export async function handleAssignFeed(request, folderId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    const body = await request.json();
    const feedId = body.feed_id || body.source_id;

    if (!feedId) return errorResponse('Feed/Source ID is required', 400);

    const folder = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?')
      .bind(folderId, session.userId).first();

    if (!folder) return errorResponse('Folder not found', 404, 'NOT_FOUND');

    const assignmentId = `ufa_${generateRandomHex(12)}`;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO user_feed_assignments (id, user_id, feed_id, folder_id, assigned_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(assignmentId, session.userId, feedId, folderId, Date.now()).run();

    return jsonResponse({ status: 'success', message: 'Feed assigned to folder' });

  } catch (err) {
    console.error('Assign feed error:', err.message);
    return errorResponse('Failed to assign feed to folder', 500);
  }
}

export async function handleUnassignFeed(request, folderId, feedId, env) {
  const session = await verifySessionToken(request, env);
  if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (!env.DB) return errorResponse('Database connection unavailable', 500);

  try {
    await env.DB.prepare(`
      DELETE FROM user_feed_assignments 
      WHERE folder_id = ? AND feed_id = ? AND user_id = ?
    `).bind(folderId, feedId, session.userId).run();

    return jsonResponse({ status: 'success', message: 'Feed unassigned from folder' });

  } catch (err) {
    console.error('Unassign feed error:', err.message);
    return errorResponse('Failed to unassign feed from folder', 500);
  }
}
