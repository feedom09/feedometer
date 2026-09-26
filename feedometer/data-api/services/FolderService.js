/**
 * FeedOmeter 2.1 — FolderService
 * Domain Service for Folder Tree Hierarchies & Feed Categorization
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class FolderService {
  /**
   * Get all folders for a user with feed counts and children
   */
  async getUserFolders(userId) {
    const foldersRes = await query(`
      SELECT 
        f.id, f.name, f.icon, f.sort_order, f.parent_folder_id, f.created_at,
        (SELECT COUNT(*) FROM dbo.user_feed_assignments ufa WHERE ufa.folder_id = f.id) AS feed_count
      FROM dbo.folders f
      WHERE f.user_id = @userId
      ORDER BY f.sort_order ASC, f.name ASC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return foldersRes.recordset || [];
  }

  /**
   * Create a new folder
   */
  async createFolder(userId, { name, icon = '📁', parentFolderId = null, sortOrder = 0 }) {
    const folderId = 'fld_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();

    await query(`
      INSERT INTO dbo.folders (id, user_id, name, parent_folder_id, icon, sort_order, created_at)
      VALUES (@id, @userId, @name, @parentId, @icon, @sortOrder, @now)
    `, {
      id: { type: sql.NVarChar(64), value: folderId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(100), value: name.trim() },
      icon: { type: sql.NVarChar(30), value: icon },
      parentId: { type: sql.NVarChar(64), value: parentFolderId },
      sortOrder: { type: sql.Int, value: Number(sortOrder) || 0 },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, id: folderId, name, icon };
  }

  /**
   * Update folder properties
   */
  async updateFolder(userId, folderId, { name, icon, sortOrder }) {
    await query(`
      UPDATE dbo.folders
      SET
        name = COALESCE(@name, name),
        icon = COALESCE(@icon, icon),
        sort_order = COALESCE(@sortOrder, sort_order)
      WHERE id = @folderId AND user_id = @userId
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      folderId: { type: sql.NVarChar(64), value: folderId },
      name: { type: sql.NVarChar(100), value: name ? name.trim() : null },
      icon: { type: sql.NVarChar(30), value: icon || null },
      sortOrder: { type: sql.Int, value: sortOrder !== undefined ? Number(sortOrder) : null }
    });

    return { success: true, message: 'Folder updated successfully.' };
  }

  /**
   * Delete folder (and remove assignments)
   */
  async deleteFolder(userId, folderId) {
    await query(`
      DELETE FROM dbo.user_feed_assignments WHERE folder_id = @folderId;
      DELETE FROM dbo.folders WHERE id = @folderId AND user_id = @userId;
    `, {
      folderId: { type: sql.NVarChar(64), value: folderId },
      userId: { type: sql.NVarChar(64), value: userId }
    });

    return { success: true, message: 'Folder deleted successfully.' };
  }

  /**
   * Assign a feed to a folder
   */
  async assignFeedToFolder(userId, userFeedId, folderId) {
    // Verify user ownership
    const verify = await query(`
      SELECT uf.id FROM dbo.user_feeds uf
      INNER JOIN dbo.folders f ON f.id = @folderId
      WHERE uf.id = @userFeedId AND uf.user_id = @userId AND f.user_id = @userId
    `, {
      userFeedId: { type: sql.NVarChar(64), value: userFeedId },
      folderId: { type: sql.NVarChar(64), value: folderId },
      userId: { type: sql.NVarChar(64), value: userId }
    });

    if (!verify.recordset || verify.recordset.length === 0) {
      throw new Error('Invalid feed or folder permission.');
    }

    const ufaId = 'ufa_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();

    await query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.user_feed_assignments WHERE user_feed_id = @userFeedId AND folder_id = @folderId)
      BEGIN
        INSERT INTO dbo.user_feed_assignments (id, user_feed_id, folder_id, assigned_at)
        VALUES (@id, @userFeedId, @folderId, @now)
      END
    `, {
      id: { type: sql.NVarChar(64), value: ufaId },
      userFeedId: { type: sql.NVarChar(64), value: userFeedId },
      folderId: { type: sql.NVarChar(64), value: folderId },
      now: { type: sql.BigInt, value: now }
    });

    return { success: true, message: 'Feed assigned to folder.' };
  }
}

module.exports = new FolderService();
