const express = require('express');
const router = express.Router();
const ArticleService = require('../services/ArticleService');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');
const { query, sql } = require('../config/db');

// List articles with filters (GET /api/articles)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { sourceId, folderId, isStarred, isSaved, isUnreadOnly, tagId, search, limit, offset } = req.query;
    const userId = req.user ? req.user.id : null;

    const articles = await ArticleService.getArticles({
      userId,
      sourceId,
      folderId,
      isStarred: isStarred === 'true' || isStarred === '1',
      isSaved: isSaved === 'true' || isSaved === '1',
      isUnreadOnly: isUnreadOnly === 'true' || isUnreadOnly === '1',
      tagId,
      search,
      limit,
      offset
    });

    res.json({ success: true, articles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/articles/starred
router.get('/starred', requireAuth, async (req, res) => {
  try {
    const articles = await ArticleService.getArticles({
      userId: req.user.id,
      isStarred: true,
      limit: req.query.limit || 100,
      offset: req.query.offset || 0
    });
    res.json({ status: 'success', success: true, items: articles, articles });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// GET /api/articles/saved
router.get('/saved', requireAuth, async (req, res) => {
  try {
    const articles = await ArticleService.getArticles({
      userId: req.user.id,
      isSaved: true,
      limit: req.query.limit || 100,
      offset: req.query.offset || 0
    });
    res.json({ status: 'success', success: true, items: articles, articles });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Star article (POST /api/articles/star)
router.post('/star', requireAuth, async (req, res) => {
  try {
    const { article_id, articleId, url, title, snippet, image, image_url, published, source_id, source_title } = req.body;
    let targetArticleId = article_id || articleId;

    if (!targetArticleId && url) {
      // Find or insert article by URL
      const check = await query(`SELECT id FROM dbo.articles WHERE url = @url`, {
        url: { type: sql.NVarChar(1000), value: url }
      });
      if (check.recordset && check.recordset.length > 0) {
        targetArticleId = check.recordset[0].id;
      } else {
        const crypto = require('crypto');
        targetArticleId = 'art_' + crypto.randomBytes(12).toString('hex');
        const now = Date.now();
        await query(`
          INSERT INTO dbo.articles (id, source_id, title, url, snippet, image_url, published_at, ingested_at)
          VALUES (@id, @sourceId, @title, @url, @snippet, @image, @published, @now)
        `, {
          id: { type: sql.NVarChar(64), value: targetArticleId },
          sourceId: { type: sql.NVarChar(64), value: source_id || 'src_custom' },
          title: { type: sql.NVarChar(500), value: title || 'Starred Item' },
          url: { type: sql.NVarChar(1000), value: url },
          snippet: { type: sql.NVarChar(sql.MAX), value: snippet || null },
          image: { type: sql.NVarChar(1000), value: image || image_url || null },
          published: { type: sql.BigInt, value: published ? new Date(published).getTime() : now },
          now: { type: sql.BigInt, value: now }
        });
      }
    }

    if (!targetArticleId) return res.status(400).json({ status: 'error', success: false, message: 'article_id or url is required.' });
    const result = await ArticleService.toggleStar(req.user.id, targetArticleId);
    res.json({ status: 'success', success: true, ...result, article_id: targetArticleId });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Unstar article (POST /api/articles/unstar)
router.post('/unstar', requireAuth, async (req, res) => {
  try {
    const { article_id, articleId, url } = req.body;
    let targetArticleId = article_id || articleId;
    if (!targetArticleId && url) {
      const check = await query(`SELECT id FROM dbo.articles WHERE url = @url`, {
        url: { type: sql.NVarChar(1000), value: url }
      });
      if (check.recordset && check.recordset.length > 0) targetArticleId = check.recordset[0].id;
    }
    if (!targetArticleId) return res.status(400).json({ status: 'error', success: false, message: 'article_id is required.' });
    await query(`DELETE FROM dbo.starred_articles WHERE user_id = @userId AND article_id = @articleId`, {
      userId: { type: sql.NVarChar(64), value: req.user.id },
      articleId: { type: sql.NVarChar(64), value: targetArticleId }
    });
    res.json({ status: 'success', success: true, starred: false });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Save article (POST /api/articles/save)
router.post('/save', requireAuth, async (req, res) => {
  try {
    const { article_id, articleId, url, title, snippet, image, image_url, published, source_id } = req.body;
    let targetArticleId = article_id || articleId;

    if (!targetArticleId && url) {
      const check = await query(`SELECT id FROM dbo.articles WHERE url = @url`, {
        url: { type: sql.NVarChar(1000), value: url }
      });
      if (check.recordset && check.recordset.length > 0) {
        targetArticleId = check.recordset[0].id;
      } else {
        const crypto = require('crypto');
        targetArticleId = 'art_' + crypto.randomBytes(12).toString('hex');
        const now = Date.now();
        await query(`
          INSERT INTO dbo.articles (id, source_id, title, url, snippet, image_url, published_at, ingested_at)
          VALUES (@id, @sourceId, @title, @url, @snippet, @image, @published, @now)
        `, {
          id: { type: sql.NVarChar(64), value: targetArticleId },
          sourceId: { type: sql.NVarChar(64), value: source_id || 'src_custom' },
          title: { type: sql.NVarChar(500), value: title || 'Saved Item' },
          url: { type: sql.NVarChar(1000), value: url },
          snippet: { type: sql.NVarChar(sql.MAX), value: snippet || null },
          image: { type: sql.NVarChar(1000), value: image || image_url || null },
          published: { type: sql.BigInt, value: published ? new Date(published).getTime() : now },
          now: { type: sql.BigInt, value: now }
        });
      }
    }

    if (!targetArticleId) return res.status(400).json({ status: 'error', success: false, message: 'article_id or url is required.' });
    const result = await ArticleService.toggleSave(req.user.id, targetArticleId);
    res.json({ status: 'success', success: true, ...result, article_id: targetArticleId });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Unsave article (POST /api/articles/unsave)
router.post('/unsave', requireAuth, async (req, res) => {
  try {
    const { article_id, articleId, url } = req.body;
    let targetArticleId = article_id || articleId;
    if (!targetArticleId && url) {
      const check = await query(`SELECT id FROM dbo.articles WHERE url = @url`, {
        url: { type: sql.NVarChar(1000), value: url }
      });
      if (check.recordset && check.recordset.length > 0) targetArticleId = check.recordset[0].id;
    }
    if (!targetArticleId) return res.status(400).json({ status: 'error', success: false, message: 'article_id is required.' });
    await query(`DELETE FROM dbo.saved_articles WHERE user_id = @userId AND article_id = @articleId`, {
      userId: { type: sql.NVarChar(64), value: req.user.id },
      articleId: { type: sql.NVarChar(64), value: targetArticleId }
    });
    res.json({ status: 'success', success: true, saved: false });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Mark Read / Unread (POST /api/articles/read)
router.post('/read', requireAuth, async (req, res) => {
  try {
    const { article_id, articleId, isRead, url } = req.body;
    let targetArticleId = article_id || articleId;
    if (!targetArticleId && url) {
      const check = await query(`SELECT id FROM dbo.articles WHERE url = @url`, {
        url: { type: sql.NVarChar(1000), value: url }
      });
      if (check.recordset && check.recordset.length > 0) targetArticleId = check.recordset[0].id;
    }
    if (!targetArticleId) return res.status(400).json({ status: 'error', success: false, message: 'article_id is required.' });
    const result = await ArticleService.markRead(req.user.id, targetArticleId, isRead !== undefined ? isRead : true);
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Mark all read (POST /api/articles/mark-all-read)
router.post('/mark-all-read', requireAuth, async (req, res) => {
  try {
    const { sourceId, folderId } = req.body;
    const result = await ArticleService.markAllRead(req.user.id, { sourceId, folderId });
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Track article interaction event
router.post('/event', optionalAuth, async (req, res) => {
  try {
    const { articleId, eventType, sourceId, metadata } = req.body;
    if (!articleId || !eventType) return res.status(400).json({ status: 'error', success: false, message: 'articleId and eventType required.' });
    const userId = req.user ? req.user.id : null;
    await ArticleService.trackArticleEvent(userId, articleId, eventType, sourceId, metadata);
    res.json({ status: 'success', success: true });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

module.exports = router;
