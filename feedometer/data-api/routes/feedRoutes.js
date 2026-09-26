const express = require('express');
const router = express.Router();
const FeedService = require('../services/FeedService');
const PlanEntitlementService = require('../services/PlanEntitlementService');
const { requireAuth, optionalAuth } = require('../middleware/authMiddleware');

// List verified sources directory / catalog
router.get(['/sources', '/catalog', '/'], optionalAuth, async (req, res) => {
  try {
    const { category, search, limit, offset } = req.query;
    const sources = await FeedService.listSources({ category, search, limit, offset });
    res.json({ status: 'success', success: true, sources, feeds: sources });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Get user subscribed feeds
router.get(['/user-feeds', '/subscriptions'], requireAuth, async (req, res) => {
  try {
    const feeds = await FeedService.getUserFeeds(req.user.id);
    res.json({ status: 'success', success: true, subscriptions: feeds, feeds });
  } catch (err) {
    res.status(500).json({ status: 'error', success: false, message: err.message });
  }
});

// Subscribe to feed (POST /api/feeds/subscribe or POST /api/subscriptions)
router.post(['/subscribe', '/subscriptions', '/'], requireAuth, async (req, res) => {
  try {
    const entitlement = await PlanEntitlementService.checkEntitlement(req.user.id, 'feed');
    if (!entitlement.allowed) {
      return res.status(403).json({
        status: 'error',
        success: false,
        message: `Feed limit reached (${entitlement.current}/${entitlement.max}) for your ${entitlement.plan} plan. Please upgrade to Pro for more feeds.`
      });
    }

    const { sourceId, source_id, feedUrl, url, feed_url, title, siteUrl, website_url, category, folderId, folder_id } = req.body;
    const result = await FeedService.subscribeFeed(req.user.id, {
      sourceId: sourceId || source_id,
      feedUrl: feedUrl || url || feed_url,
      title,
      siteUrl: siteUrl || website_url,
      category,
      folderId: folderId || folder_id
    });
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Unsubscribe from feed (POST /api/feeds/unsubscribe)
router.post('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { sourceId, source_id, id } = req.body;
    const targetId = sourceId || source_id || id;
    if (!targetId) return res.status(400).json({ status: 'error', success: false, message: 'sourceId is required.' });
    const result = await FeedService.unsubscribeFeed(req.user.id, targetId);
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// DELETE /api/subscriptions/:id
router.delete(['/subscriptions/:id', '/:id'], requireAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const result = await FeedService.unsubscribeFeed(req.user.id, targetId);
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

// Submit feed for community review
router.post('/submit', optionalAuth, async (req, res) => {
  try {
    const { feedUrl, url, feed_url, suggestedName, name, category, notes } = req.body;
    const targetUrl = feedUrl || url || feed_url;
    if (!targetUrl) return res.status(400).json({ status: 'error', success: false, message: 'feedUrl is required.' });
    const userId = req.user ? req.user.id : null;
    const result = await FeedService.submitFeed({ userId, feedUrl: targetUrl, suggestedName: suggestedName || name, category, notes });
    res.json({ status: 'success', success: true, ...result });
  } catch (err) {
    res.status(400).json({ status: 'error', success: false, message: err.message });
  }
});

module.exports = router;
