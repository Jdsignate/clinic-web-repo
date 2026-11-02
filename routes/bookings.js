const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, execSql, saveDatabase } = require('../db');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /bookings — Book a slot (levels 1-5)
router.post('/', rateLimiter, (req, res) => {
  const { slot_id, name, email } = req.body || {};
  const idempotencyKey = req.headers['idempotency-key'] || null;

  // Level 2: 400 if slot_id, name or email is missing or empty, or email isn't valid.
  if (!slot_id || typeof slot_id !== 'string' || !slot_id.trim()) {
    return res.status(400).json({ error: 'slot_id is required' });
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email is required' });
  }

  const cleanSlotId = slot_id.trim();
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(cleanEmail)) {
    return res.status(400).json({ error: 'invalid email format' });
  }

  // Level 4: Idempotency check
  const normalizedBody = JSON.stringify({
    slot_id: cleanSlotId,
    name: cleanName,
    email: cleanEmail,
  });

  if (idempotencyKey) {
    const existing = queryOne(
      'SELECT id, slot_id, name, email, status, created_at, idempotency_body FROM bookings WHERE idempotency_key = ?',
      [idempotencyKey]
    );

    if (existing) {
      if (existing.idempotency_body === normalizedBody) {
        return res.status(201).json({
          id: existing.id,
          slot_id: existing.slot_id,
          name: existing.name,
          email: existing.email,
          status: existing.status,
          created_at: existing.created_at,
        });
      } else {
        // Same key with different body: 422
        return res.status(422).json({
          error: 'idempotency key reused with different body',
        });
      }
    }
  }

  // Level 2: 404 if the slot doesn't exist
  const slot = queryOne('SELECT id, provider, start, end FROM slots WHERE id = ?', [cleanSlotId]);
  if (!slot) {
    return res.status(404).json({ error: 'slot not found' });
  }

  // Level 2: 400 if the slot has already started
  const now = new Date();
  const slotStart = new Date(slot.start);
  if (slotStart.getTime() <= now.getTime()) {
    return res.status(400).json({ error: 'slot has already started' });
  }

  // Level 3: 409 if slot already has a confirmed booking
  const existingBooking = queryOne(
    "SELECT id FROM bookings WHERE slot_id = ? AND status = 'confirmed'",
    [cleanSlotId]
  );
  if (existingBooking) {
    return res.status(409).json({ error: 'slot already booked' });
  }

  // Create confirmed booking
  const bookingId = uuidv4();
  const createdAt = new Date().toISOString();

  execSql(
    `INSERT INTO bookings (id, slot_id, name, email, status, created_at, idempotency_key, idempotency_body)
     VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
    [bookingId, cleanSlotId, cleanName, cleanEmail, createdAt, idempotencyKey, normalizedBody]
  );

  saveDatabase();

  return res.status(201).json({
    id: bookingId,
    slot_id: cleanSlotId,
    name: cleanName,
    email: cleanEmail,
    status: 'confirmed',
    created_at: createdAt,
  });
});

// GET /bookings — List a person's bookings (Level 4 cursor pagination)
router.get('/', (req, res) => {
  const { email, limit: limitQuery, cursor } = req.query;

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Validate limit (1 to 50, default 10)
  let limit = 10;
  if (limitQuery !== undefined) {
    const parsed = Number(limitQuery);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return res.status(400).json({ error: 'invalid limit: must be an integer between 1 and 50' });
    }
    limit = parsed;
  }

  // Parse cursor if provided
  let cursorCreatedAt = null;
  let cursorId = null;

  if (cursor && typeof cursor === 'string') {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded);
      cursorCreatedAt = parsed.c;
      cursorId = parsed.i;
    } catch (_) {
      // If cursor is direct booking id
      const cursorBooking = queryOne(
        'SELECT id, created_at FROM bookings WHERE id = ?',
        [cursor]
      );
      if (cursorBooking) {
        cursorCreatedAt = cursorBooking.created_at;
        cursorId = cursorBooking.id;
      }
    }
  }

  let sql = 'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE LOWER(email) = ?';
  const params = [cleanEmail];

  if (cursorCreatedAt && cursorId) {
    sql += ' AND (created_at > ? OR (created_at = ? AND id > ?))';
    params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  }

  sql += ' ORDER BY created_at ASC, id ASC LIMIT ?';
  params.push(limit + 1); // fetch one extra to see if there is a next page

  const rows = queryAll(sql, params);

  let next_cursor = null;
  let items = rows;

  if (rows.length > limit) {
    items = rows.slice(0, limit);
    const lastItem = items[items.length - 1];
    next_cursor = Buffer.from(
      JSON.stringify({ c: lastItem.created_at, i: lastItem.id })
    ).toString('base64url');
  }

  res.status(200).json({
    bookings: items.map((b) => ({
      id: b.id,
      slot_id: b.slot_id,
      name: b.name,
      email: b.email,
      status: b.status,
      created_at: b.created_at,
    })),
    next_cursor,
  });
});

// GET /bookings/:id — Get a booking (Level 1)
router.get('/:id', (req, res) => {
  const { id } = req.params;

  const booking = queryOne(
    'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ?',
    [id]
  );

  if (!booking) {
    return res.status(404).json({ error: 'booking not found' });
  }

  res.status(200).json({
    id: booking.id,
    slot_id: booking.slot_id,
    name: booking.name,
    email: booking.email,
    status: booking.status,
    created_at: booking.created_at,
  });
});

// DELETE /bookings/:id — Cancel a booking (Level 3)
function handleCancel(req, res) {
  const { id } = req.params;

  const booking = queryOne(
    'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ?',
    [id]
  );

  if (!booking) {
    return res.status(404).json({ error: 'booking not found' });
  }

  if (booking.status === 'cancelled') {
    return res.status(409).json({ error: 'already cancelled' });
  }

  execSql("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [id]);
  saveDatabase();

  res.status(200).json({
    id: booking.id,
    slot_id: booking.slot_id,
    name: booking.name,
    email: booking.email,
    status: 'cancelled',
    created_at: booking.created_at,
  });
}

router.delete('/:id', handleCancel);
router.patch('/:id/cancel', handleCancel);

module.exports = router;
