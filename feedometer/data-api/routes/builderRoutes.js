const express = require('express');
const router = express.Router();
const BuilderService = require('../services/BuilderService');
const PlanEntitlementService = require('../services/PlanEntitlementService');
const { requireAuth } = require('../middleware/authMiddleware');

// Get builder recipes
router.get('/builder/configs', requireAuth, async (req, res) => {
  try {
    const configs = await BuilderService.getUserConfigs(req.user.id);
    res.json({ success: true, configs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save builder recipe
router.post('/builder/configs', requireAuth, async (req, res) => {
  try {
    const entitlement = await PlanEntitlementService.checkEntitlement(req.user.id, 'builder');
    if (!entitlement.allowed) {
      return res.status(403).json({
        success: false,
        error: `Custom builder recipes limit reached (${entitlement.current}/${entitlement.max}) for your ${entitlement.plan} plan.`
      });
    }

    const { id, name, targetUrl, selectors, paginationType } = req.body;
    if (!name || !targetUrl) return res.status(400).json({ success: false, error: 'name and targetUrl required.' });
    const result = await BuilderService.saveConfig(req.user.id, { id, name, targetUrl, selectors, paginationType });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete builder recipe
router.delete('/builder/configs/:id', requireAuth, async (req, res) => {
  try {
    const result = await BuilderService.deleteConfig(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get domain patterns
router.get('/builder/patterns', async (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required.' });
    const patterns = await BuilderService.getDomainPatterns(domain);
    res.json({ success: true, patterns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
