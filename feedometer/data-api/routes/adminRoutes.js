const express = require('express');
const router = express.Router();
const AdminService = require('../services/AdminService');
const AuditService = require('../services/AuditService');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

// Telemetry & metrics overview
router.get('/admin/metrics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const metrics = await AdminService.getSystemMetrics();
    res.json({ success: true, metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List users
router.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { page, limit, role, status, search } = req.query;
    const usersData = await AdminService.listUsers({ page, limit, role, status, search });
    res.json({ success: true, ...usersData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update user account
router.put('/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, role, plan } = req.body;
    const result = await AdminService.updateUserAccount(req.params.id, { status, role, plan });
    AuditService.log({
      userId: req.user.id,
      action: 'admin.update_user',
      details: { targetUserId: req.params.id, status, role, plan },
      ipAddress: req.ip
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Publishers directory
router.get('/admin/publishers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const publishers = await AdminService.listPublishers();
    res.json({ success: true, publishers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upsert publisher
router.post('/admin/publishers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { domain, name, category, logoUrl, isPopular } = req.body;
    if (!domain || !name) return res.status(400).json({ success: false, error: 'domain and name are required.' });
    const result = await AdminService.upsertPublisher({ domain, name, category, logoUrl, isPopular });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Audit logs
router.get('/admin/audit-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, action, limit, offset } = req.query;
    const logs = await AuditService.getLogs({ userId, action, limit, offset });
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
