const express = require('express');
const router = express.Router();
const WatchlistService = require('../services/WatchlistService');
const { requireAuth } = require('../middleware/authMiddleware');

// Get all collections/watchlists
router.get('/watchlists', requireAuth, async (req, res) => {
  try {
    const collections = await WatchlistService.getCollections(req.user.id);
    res.json({ success: true, collections });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create collection
router.post('/watchlists', requireAuth, async (req, res) => {
  try {
    const { name, description, isPublic } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required.' });
    const result = await WatchlistService.createCollection(req.user.id, { name, description, isPublic });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Add article to collection
router.post('/watchlists/:id/articles', requireAuth, async (req, res) => {
  try {
    const { articleId, notes } = req.body;
    if (!articleId) return res.status(400).json({ success: false, error: 'articleId is required.' });
    const result = await WatchlistService.addArticleToCollection(req.user.id, req.params.id, articleId, notes);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Remove article from collection
router.delete('/watchlists/:id/articles/:articleId', requireAuth, async (req, res) => {
  try {
    const result = await WatchlistService.removeArticleFromCollection(req.user.id, req.params.id, req.params.articleId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get user tags
router.get('/tags', requireAuth, async (req, res) => {
  try {
    const tags = await WatchlistService.getUserTags(req.user.id);
    res.json({ success: true, tags });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create tag
router.post('/tags', requireAuth, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required.' });
    const result = await WatchlistService.createTag(req.user.id, { name, color });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Assign tag to article
router.post('/tags/assign', requireAuth, async (req, res) => {
  try {
    const { tagId, articleId } = req.body;
    if (!tagId || !articleId) return res.status(400).json({ success: false, error: 'tagId and articleId required.' });
    const result = await WatchlistService.tagArticle(req.user.id, tagId, articleId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
