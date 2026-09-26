const express = require('express');
const router = express.Router();
const SearchService = require('../services/SearchService');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');

// Search articles
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { q, category, limit, offset, sessionId } = req.query;
    const userId = req.user ? req.user.id : null;
    const result = await SearchService.search({
      userId,
      queryText: q,
      category,
      limit,
      offset,
      sessionId,
      ipAddress: req.ip
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Autocomplete suggestions
router.get('/search/suggestions', async (req, res) => {
  try {
    const { q, limit } = req.query;
    const suggestions = await SearchService.getSuggestions(q, limit);
    res.json({ success: true, suggestions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save search
router.post('/search/saved', requireAuth, async (req, res) => {
  try {
    const { name, query: queryText, filters } = req.body;
    if (!queryText) return res.status(400).json({ success: false, error: 'query is required.' });
    const result = await SearchService.saveSearch(req.user.id, { name, queryText, filters });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get saved searches
router.get('/search/saved', requireAuth, async (req, res) => {
  try {
    const saved = await SearchService.getSavedSearches(req.user.id);
    res.json({ success: true, saved_searches: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search click tracking
router.post('/search/click', async (req, res) => {
  try {
    const { queryId, articleId, position } = req.body;
    if (!queryId || !articleId) return res.status(400).json({ success: false, error: 'queryId and articleId required.' });
    const result = await SearchService.logSearchClick(queryId, articleId, position);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
