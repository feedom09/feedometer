const express = require('express');
const router = express.Router();
const UserService = require('../services/UserService');
const { requireAuth } = require('../middleware/authMiddleware');

// Get current user profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const profile = await UserService.getProfile(req.user.id);
    res.json({ success: true, profile });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// Update profile
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const updated = await UserService.updateProfile(req.user.id, req.body);
    res.json({ success: true, profile: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update preferences
router.put('/preferences', requireAuth, async (req, res) => {
  try {
    const result = await UserService.updatePreferences(req.user.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Notify signup (waitlist / newsletter)
router.post('/notify-signup', async (req, res) => {
  try {
    const { email, source, planInterest } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });
    const result = await UserService.saveNotifySignup({ email, source, planInterest, ipAddress: req.ip });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
