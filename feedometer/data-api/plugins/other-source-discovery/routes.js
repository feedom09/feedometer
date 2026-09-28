const express = require('express'); const { TYPES, byId } = require('./types'); const engine = require('./engine');
const router = express.Router();
router.get('/types', (req, res) => res.json({ success: true, enabled: engine.enabled(), types: TYPES }));
router.get('/search', async (req, res) => {
  try { const type = String(req.query.type || ''); const query = String(req.query.query || req.query.q || ''); const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 25); if (!byId.has(type)) return res.status(400).json({ success: false, message: 'A valid type is required.' });
    const outcome = await engine.search(query, type, limit); res.json({ success: true, query, type, label: byId.get(type).label, ...outcome, total: outcome.results.length });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});
module.exports = router;
