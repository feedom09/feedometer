/**
 * FeedOmeter 2.1 — WatchlistService
 * Domain Service for Curated Collections, Watchlists & Article Tagging
 */

const crypto = require('crypto');
const { query, sql } = require('../config/db');

class WatchlistService {
  /**
   * Get all collections/watchlists for user
   */
  async getCollections(userId) {
    const res = await query(`
      SELECT 
        c.id, c.name, c.description, c.is_public, c.created_at, c.updated_at,
        (SELECT COUNT(*) FROM dbo.collection_articles ca WHERE ca.collection_id = c.id) AS article_count
      FROM dbo.user_collections c
      WHERE c.user_id = @userId
      ORDER BY c.updated_at DESC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Create a collection
   */
  async createCollection(userId, { name, description = '', isPublic = false }) {
    const colId = 'col_' + crypto.randomBytes(12).toString('hex');
    await query(`
      INSERT INTO dbo.user_collections (id, user_id, name, description, is_public, created_at, updated_at)
      VALUES (@id, @userId, @name, @description, @isPublic, SYSUTCDATETIME(), SYSUTCDATETIME())
    `, {
      id: { type: sql.NVarChar(64), value: colId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(128), value: name.trim() },
      description: { type: sql.NVarChar(500), value: description || null },
      isPublic: { type: sql.Bit, value: isPublic ? 1 : 0 }
    });

    return { success: true, id: colId, name };
  }

  /**
   * Add article to a collection
   */
  async addArticleToCollection(userId, collectionId, articleId, notes = '') {
    // Verify collection ownership
    const check = await query(`SELECT id FROM dbo.user_collections WHERE id = @colId AND user_id = @userId`, {
      colId: { type: sql.NVarChar(64), value: collectionId },
      userId: { type: sql.NVarChar(64), value: userId }
    });

    if (!check.recordset || check.recordset.length === 0) {
      throw new Error('Collection not found.');
    }

    const assignmentId = 'ca_' + crypto.randomBytes(12).toString('hex');
    await query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.collection_articles WHERE collection_id = @colId AND article_id = @artId)
      BEGIN
        INSERT INTO dbo.collection_articles (id, collection_id, article_id, notes, added_at)
        VALUES (@id, @colId, @artId, @notes, SYSUTCDATETIME());

        UPDATE dbo.user_collections SET updated_at = SYSUTCDATETIME() WHERE id = @colId;
      END
    `, {
      id: { type: sql.NVarChar(64), value: assignmentId },
      colId: { type: sql.NVarChar(64), value: collectionId },
      artId: { type: sql.NVarChar(64), value: articleId },
      notes: { type: sql.NVarChar(1000), value: notes || null }
    });

    return { success: true, message: 'Article added to collection.' };
  }

  /**
   * Remove article from collection
   */
  async removeArticleFromCollection(userId, collectionId, articleId) {
    await query(`
      DELETE ca FROM dbo.collection_articles ca
      INNER JOIN dbo.user_collections c ON ca.collection_id = c.id
      WHERE ca.collection_id = @colId AND ca.article_id = @artId AND c.user_id = @userId;

      UPDATE dbo.user_collections SET updated_at = SYSUTCDATETIME() WHERE id = @colId AND user_id = @userId;
    `, {
      colId: { type: sql.NVarChar(64), value: collectionId },
      artId: { type: sql.NVarChar(64), value: articleId },
      userId: { type: sql.NVarChar(64), value: userId }
    });

    return { success: true, message: 'Article removed from collection.' };
  }

  /**
   * Get user tags
   */
  async getUserTags(userId) {
    const res = await query(`
      SELECT 
        t.id, t.name, t.color, t.created_at,
        (SELECT COUNT(*) FROM dbo.article_tag_assignments ata WHERE ata.tag_id = t.id) AS article_count
      FROM dbo.user_article_tags t
      WHERE t.user_id = @userId
      ORDER BY t.name ASC
    `, { userId: { type: sql.NVarChar(64), value: userId } });

    return res.recordset || [];
  }

  /**
   * Create tag
   */
  async createTag(userId, { name, color = '#3b82f6' }) {
    const tagId = 'tag_' + crypto.randomBytes(12).toString('hex');
    await query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.user_article_tags WHERE user_id = @userId AND name = @name)
      BEGIN
        INSERT INTO dbo.user_article_tags (id, user_id, name, color, created_at)
        VALUES (@id, @userId, @name, @color, SYSUTCDATETIME())
      END
    `, {
      id: { type: sql.NVarChar(64), value: tagId },
      userId: { type: sql.NVarChar(64), value: userId },
      name: { type: sql.NVarChar(64), value: name.trim() },
      color: { type: sql.VarChar(32), value: color }
    });

    return { success: true, id: tagId, name, color };
  }

  /**
   * Tag an article
   */
  async tagArticle(userId, tagId, articleId) {
    await query(`
      IF EXISTS (SELECT 1 FROM dbo.user_article_tags WHERE id = @tagId AND user_id = @userId)
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.article_tag_assignments WHERE tag_id = @tagId AND article_id = @articleId)
        BEGIN
          INSERT INTO dbo.article_tag_assignments (tag_id, article_id, created_at)
          VALUES (@tagId, @articleId, SYSUTCDATETIME())
        END
      END
    `, {
      userId: { type: sql.NVarChar(64), value: userId },
      tagId: { type: sql.NVarChar(64), value: tagId },
      articleId: { type: sql.NVarChar(64), value: articleId }
    });

    return { success: true, message: 'Article tagged successfully.' };
  }
}

module.exports = new WatchlistService();
