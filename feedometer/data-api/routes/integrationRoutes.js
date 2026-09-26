const express = require('express');
const router = express.Router();
const IntegrationService = require('../services/IntegrationService');
const { requireAuth } = require('../middleware/authMiddleware');

// Get available third-party integrations
router.get('/integrations', async (req, res) => {
  try {
    const integrations = await IntegrationService.getAvailableIntegrations();
    res.json({ success: true, integrations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get user connected integrations
router.get('/user-integrations', requireAuth, async (req, res) => {
  try {
    const userIntegrations = await IntegrationService.getUserIntegrations(req.user.id);
    res.json({ success: true, integrations: userIntegrations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List user API keys
router.get('/api-keys', requireAuth, async (req, res) => {
  try {
    const keys = await IntegrationService.listApiKeys(req.user.id);
    res.json({ success: true, api_keys: keys });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create API key
router.post('/api-keys', requireAuth, async (req, res) => {
  try {
    const { name, scopes, expiresDays } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required.' });
    const result = await IntegrationService.createApiKey(req.user.id, { name, scopes, expiresDays });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Revoke API key
router.delete('/api-keys/:id', requireAuth, async (req, res) => {
  try {
    const result = await IntegrationService.revokeApiKey(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
