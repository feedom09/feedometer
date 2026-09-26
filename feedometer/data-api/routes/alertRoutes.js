const express = require('express');
const router = express.Router();
const AlertService = require('../services/AlertService');
const PlanEntitlementService = require('../services/PlanEntitlementService');
const { requireAuth } = require('../middleware/authMiddleware');

// Get alerts
router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const alerts = await AlertService.getUserAlerts(req.user.id);
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create alert
router.post('/alerts', requireAuth, async (req, res) => {
  try {
    const entitlement = await PlanEntitlementService.checkEntitlement(req.user.id, 'alert');
    if (!entitlement.allowed) {
      return res.status(403).json({
        success: false,
        error: `Alert limit reached (${entitlement.current}/${entitlement.max}) for your ${entitlement.plan} plan.`
      });
    }

    const { name, alertType, targetId, conditionType, thresholdValue, deliveryChannel } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required.' });
    const result = await AlertService.createAlert(req.user.id, {
      name,
      alertType,
      targetId,
      conditionType,
      thresholdValue,
      deliveryChannel
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update alert
router.put('/alerts/:id', requireAuth, async (req, res) => {
  try {
    const result = await AlertService.updateAlert(req.user.id, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete alert
router.delete('/alerts/:id', requireAuth, async (req, res) => {
  try {
    const result = await AlertService.deleteAlert(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get user webhooks
router.get('/webhooks', requireAuth, async (req, res) => {
  try {
    const webhooks = await AlertService.getUserWebhooks(req.user.id);
    res.json({ success: true, webhooks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create webhook
router.post('/webhooks', requireAuth, async (req, res) => {
  try {
    const { name, url, secret, eventTypes } = req.body;
    if (!name || !url) return res.status(400).json({ success: false, error: 'name and url are required.' });
    const result = await AlertService.createWebhook(req.user.id, { name, url, secret, eventTypes });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
