const express = require('express');
const router = express.Router();
const FolderService = require('../services/FolderService');
const PlanEntitlementService = require('../services/PlanEntitlementService');
const { requireAuth } = require('../middleware/authMiddleware');
const { query, sql } = require('../config/db');

// Get all folders (GET /api/folders)
router.get(['/', '/folders'], requireAuth, async (req, res) => {
  try {
    const folders = await FolderService.getUserFolders(req.user.id);
    res.json({ status: 'success', success: true, folders });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Create folder (POST /api/folders)
router.post(['/', '/folders'], requireAuth, async (req, res) => {
  try {
    const entitlement = await PlanEntitlementService.checkEntitlement(req.user.id, 'folder');
    if (!entitlement.allowed) {
      return res.status(403).json({
        status: 'error',
        success: false,
        message: `Folder limit reached (${entitlement.current}/${entitlement.max}) for your ${entitlement.plan} plan.`
      });
    }

    const { name, title, color, icon, parentFolderId, parent_folder_id, sortOrder, sort_order } = req.body;
    const folderName = name || title;
    if (!folderName) return res.status(400).json({ status: 'error', success: false, message: 'name is required.' });
    const result = await FolderService.createFolder(req.user.id, {
      name: folderName,
      color,
      icon,
      parentFolderId: parentFolderId || parent_folder_id,
      sortOrder: sortOrder || sort_order
    });
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Assign feed to folder (POST /api/folders/:folderId/feeds)
router.post(['/:id/feeds', '/assign'], requireAuth, async (req, res) => {
  try {
    const folderId = req.params.id || req.body.folderId || req.body.folder_id;
    const feedId = req.body.source_id || req.body.sourceId || req.body.feed_id || req.body.feedId || req.body.userFeedId;
    if (!folderId || !feedId) {
      return res.status(400).json({ status: 'error', success: false, message: 'folderId and feedId/sourceId are required.' });
    }

    // Lookup user_feed_id if source_id was given
    let userFeedId = feedId;
    const ufCheck = await query(`SELECT id FROM dbo.user_feeds WHERE user_id = @userId AND (id = @feedId OR source_id = @feedId)`, {
      userId: { type: sql.NVarChar(64), value: req.user.id },
      feedId: { type: sql.NVarChar(64), value: feedId }
    });

    if (ufCheck.recordset && ufCheck.recordset.length > 0) {
      userFeedId = ufCheck.recordset[0].id;
    }

    const result = await FolderService.assignFeedToFolder(req.user.id, userFeedId, folderId);
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Unassign feed from folder (DELETE /api/folders/:folderId/feeds/:feedId)
router.delete('/:id/feeds/:feedId', requireAuth, async (req, res) => {
  try {
    const folderId = req.params.id;
    const feedId = req.params.feedId;

    await query(`
      DELETE ufa FROM dbo.user_feed_assignments ufa
      INNER JOIN dbo.user_feeds uf ON ufa.user_feed_id = uf.id
      WHERE ufa.folder_id = @folderId AND uf.user_id = @userId AND (uf.id = @feedId OR uf.source_id = @feedId)
    `, {
      folderId: { type: sql.NVarChar(64), value: folderId },
      userId: { type: sql.NVarChar(64), value: req.user.id },
      feedId: { type: sql.NVarChar(64), value: feedId }
    });

    res.json({ status: 'success', success: true, message: 'Feed removed from folder.' });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Update folder (PUT /api/folders/:id)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const result = await FolderService.updateFolder(req.user.id, req.params.id, req.body);
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Delete folder (DELETE /api/folders/:id)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await FolderService.deleteFolder(req.user.id, req.params.id);
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

module.exports = router;
