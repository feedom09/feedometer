const express = require('express');
const router = express.Router();
const { previewWebsite, getPreviewJob } = require('../services/WebsitePreviewService');

router.get('/feed-preview/:jobId', (req, res) => {
  const snapshot = getPreviewJob(req.params.jobId);
  if (!snapshot) return res.status(404).json({ status: 'error', success: false, message: 'This preview has expired. Please run it again.' });
  res.json(snapshot);
});

router.post(['/feed-preview', '/test-feed'], async (req, res) => {
  const targetUrl = req.body && (req.body.url || req.body.site);
  if (!targetUrl) return res.status(400).json({ status: 'error', success: false, message: 'Missing url parameter.' });
  try {
    res.json(await previewWebsite(targetUrl, { limit: req.body.limit }));
  } catch (error) {
    res.status(422).json({ status: 'error', success: false, url: targetUrl, articles: [], count: 0, message: error.message || 'Preview failed.', recovery: error.recovery || null });
  }
});

module.exports = router;
