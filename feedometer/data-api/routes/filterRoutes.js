/**
 * FeedOmeter 2.1 — Filter Routes
 * Controller for persisting and retrieving user feed filtering & deduplication rules
 */

const express = require('express');
const router = express.Router();
const { query, sql } = require('../config/db');
const { requireAuth } = require('../middleware/authMiddleware');

// GET /api/filters - Get user saved filter rules
router.get('/filters', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT user_id, rules_json, updated_at
      FROM dbo.user_filter_rules
      WHERE user_id = @userId
    `, {
      userId: { type: sql.NVarChar(64), value: req.user.id }
    });

    if (!result.recordset || result.recordset.length === 0) {
      return res.json({ success: true, rules: {}, updated_at: null });
    }

    const row = result.recordset[0];
    let parsedRules = {};
    try {
      parsedRules = JSON.parse(row.rules_json || '{}');
    } catch (_) {
      parsedRules = {};
    }

    res.json({
      success: true,
      rules: parsedRules,
      updated_at: row.updated_at
    });
  } catch (err) {
    console.error('[FilterRoutes] GET /filters error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/filters or POST /api/filters - Save/Update user filter rules
router.all(['/filters'], requireAuth, async (req, res, next) => {
  if (req.method !== 'PUT' && req.method !== 'POST') return next();

  try {
    const rules = req.body.rules || req.body;
    if (!rules || typeof rules !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid filter rules payload.' });
    }

    const rulesJson = JSON.stringify(rules);
    const now = Date.now();

    await query(`
      IF EXISTS (SELECT 1 FROM dbo.user_filter_rules WHERE user_id = @userId)
      BEGIN
        UPDATE dbo.user_filter_rules
        SET rules_json = @rulesJson, updated_at = @now
        WHERE user_id = @userId
      END
      ELSE
      BEGIN
        INSERT INTO dbo.user_filter_rules (user_id, rules_json, updated_at)
        VALUES (@userId, @rulesJson, @now)
      END
    `, {
      userId: { type: sql.NVarChar(64), value: req.user.id },
      rulesJson: { type: sql.NVarChar(sql.MAX), value: rulesJson },
      now: { type: sql.BigInt, value: now }
    });

    res.json({
      success: true,
      message: 'Filter rules saved successfully.',
      rules: rules,
      updated_at: now
    });
  } catch (err) {
    console.error('[FilterRoutes] Save filters error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/filters - Clear user filter rules
router.delete('/filters', requireAuth, async (req, res) => {
  try {
    await query(`
      DELETE FROM dbo.user_filter_rules WHERE user_id = @userId
    `, {
      userId: { type: sql.NVarChar(64), value: req.user.id }
    });

    res.json({ success: true, message: 'Filter rules cleared.' });
  } catch (err) {
    console.error('[FilterRoutes] DELETE /filters error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
