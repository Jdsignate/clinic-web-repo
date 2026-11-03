const express = require('express');
const { queryAll, execSql, saveDatabase } = require('../db');
const { resetRateLimits } = require('../middleware/rateLimiter');

const router = express.Router();

// GET /slots — List slots, earliest start first
router.get('/', async (req, res) => {
  try {
    const { provider } = req.query;

    let sql = `
      SELECT
        s.id,
        s.provider,
        s.start,
        s."end",
        CASE WHEN COUNT(b.id) > 0 THEN 0 ELSE 1 END as is_avail
      FROM slots s
      LEFT JOIN bookings b ON s.id = b.slot_id AND b.status = 'confirmed'
    `;
    const params = [];

    if (typeof provider === 'string' && provider.trim()) {
      sql += ' WHERE s.provider = ?';
      params.push(provider.trim());
    }

    sql += ' GROUP BY s.id, s.provider, s.start, s."end" ORDER BY s.start ASC';

    const rows = await queryAll(sql, params);

    const slots = rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      start: r.start,
      end: r.end,
      available: Number(r.is_avail) === 1 || r.is_avail === true,
    }));

    res.status(200).json({ slots });
  } catch (err) {
    console.error('Error fetching slots:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Shared reset handler
async function handleReset(req, res) {
  const { slots } = req.body || {};

  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: 'slots array is required' });
  }

  try {
    // Delete every booking and slot
    await execSql('DELETE FROM bookings');
    await execSql('DELETE FROM slots');

    // Insert new slots
    for (const slot of slots) {
      if (!slot.id || !slot.provider || !slot.start || !slot.end) {
        return res.status(400).json({ error: 'invalid slot structure' });
      }
      await execSql(
        'INSERT INTO slots (id, provider, start, "end") VALUES (?, ?, ?, ?)',
        [slot.id, slot.provider, slot.start, slot.end]
      );
    }

    resetRateLimits();
    saveDatabase();

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
}

router.post('/reset', handleReset);

module.exports = router;
module.exports.handleReset = handleReset;
