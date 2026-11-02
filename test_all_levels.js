const assert = require('assert');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'clinic-api-key-2026';

async function req(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

async function runTests() {
  console.log('🚀 Starting tests against', BASE_URL);

  // ════════════════════════════════════════════════════════════
  // LEVEL 2 AUTH CHECKS
  // ════════════════════════════════════════════════════════════
  console.log('\n--- LEVEL 2: API Key Checks ---');
  {
    // Missing key
    const resNoKey = await req('/slots');
    assert.strictEqual(resNoKey.status, 401, 'Missing API key must return 401');
    assert.ok(resNoKey.data.error, 'Response must have {"error": "..."}');
    console.log('✔ Missing API key returns 401');

    // Wrong key
    const resWrongKey = await req('/slots', { headers: { 'X-API-Key': 'wrong-key' } });
    assert.strictEqual(resWrongKey.status, 401, 'Wrong API key must return 401');
    assert.ok(resWrongKey.data.error, 'Response must have {"error": "..."}');
    console.log('✔ Wrong API key returns 401');
  }

  // ════════════════════════════════════════════════════════════
  // LEVEL 1: Reset & Seed Slots
  // ════════════════════════════════════════════════════════════
  console.log('\n--- LEVEL 1: Reset & Seed Slots ---');
  const futureDate1 = new Date(Date.now() + 86400000).toISOString();
  const futureDate2 = new Date(Date.now() + 90000000).toISOString();
  const pastDate1 = new Date(Date.now() - 86400000).toISOString();
  const pastDate2 = new Date(Date.now() - 80000000).toISOString();

  const testSlots = [
    { id: 'slot-future-1', provider: 'Dr Ade', start: futureDate1, end: futureDate2 },
    { id: 'slot-future-2', provider: 'Dr Ade', start: new Date(Date.now() + 100000000).toISOString(), end: new Date(Date.now() + 103600000).toISOString() },
    { id: 'slot-future-3', provider: 'Dr Smith', start: new Date(Date.now() + 110000000).toISOString(), end: new Date(Date.now() + 113600000).toISOString() },
    { id: 'slot-future-4', provider: 'Dr Smith', start: new Date(Date.now() + 120000000).toISOString(), end: new Date(Date.now() + 123600000).toISOString() },
    { id: 'slot-future-5', provider: 'Dr Smith', start: new Date(Date.now() + 130000000).toISOString(), end: new Date(Date.now() + 133600000).toISOString() },
    { id: 'slot-past-1', provider: 'Dr Ade', start: pastDate1, end: pastDate2 }
  ];

  {
    const resetRes = await req('/reset', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slots: testSlots })
    });
    assert.strictEqual(resetRes.status, 200, 'Reset should return 200');
    console.log('✔ /reset successfully replaced all slots');

    // List slots
    const slotsRes = await req('/slots', { headers: { 'X-API-Key': API_KEY } });
    assert.strictEqual(slotsRes.status, 200);
    assert.strictEqual(slotsRes.data.slots.length, testSlots.length);
    assert.strictEqual(slotsRes.data.slots[0].id, 'slot-past-1', 'Earliest start must be first');
    assert.strictEqual(typeof slotsRes.data.slots[0].available, 'boolean');
    console.log('✔ GET /slots returns all slots ordered by start time with availability flag');

    // Provider filter
    const providerRes = await req('/slots?provider=Dr%20Smith', { headers: { 'X-API-Key': API_KEY } });
    assert.strictEqual(providerRes.status, 200);
    assert.strictEqual(providerRes.data.slots.length, 3);
    assert.ok(providerRes.data.slots.every(s => s.provider === 'Dr Smith'));
    console.log('✔ GET /slots?provider=Dr%20Smith filters accurately by provider');
  }

  // ════════════════════════════════════════════════════════════
  // LEVEL 2: Validation on Bookings
  // ════════════════════════════════════════════════════════════
  console.log('\n--- LEVEL 2: Validation Checks ---');
  {
    // Missing slot_id
    const r1 = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ name: 'Ada', email: 'ada@example.com' })
    });
    assert.strictEqual(r1.status, 400);
    assert.ok(r1.data.error);

    // Missing name
    const r2 = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'slot-future-1', email: 'ada@example.com' })
    });
    assert.strictEqual(r2.status, 400);
    assert.ok(r2.data.error);

    // Invalid email
    const r3 = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'slot-future-1', name: 'Ada', email: 'invalid-email' })
    });
    assert.strictEqual(r3.status, 400);
    assert.ok(r3.data.error);

    // Slot doesn't exist
    const r4 = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'non-existent-slot', name: 'Ada', email: 'ada@example.com' })
    });
    assert.strictEqual(r4.status, 404);
    assert.ok(r4.data.error);

    // Slot has already started
    const r5 = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'slot-past-1', name: 'Ada', email: 'ada@example.com' })
    });
    assert.strictEqual(r5.status, 400);
    assert.ok(r5.data.error);

    console.log('✔ All Level 2 validation checks passed (missing fields, invalid email, 404 slot, past slot)');
  }

  // ════════════════════════════════════════════════════════════
  // LEVEL 1 & 2: Successful Booking & Trimming
  // ════════════════════════════════════════════════════════════
  console.log('\n--- LEVEL 1: Successful Booking & Lookup ---');
  let booking1 = null;
  {
    const bookRes = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({
        slot_id: 'slot-future-1',
        name: '  Ada Obi  ',
        email: '  ADA@EXAMPLE.COM  '
      })
    });
    assert.strictEqual(bookRes.status, 201);
    booking1 = bookRes.data;
    assert.ok(booking1.id, 'Booking must have an id');
    assert.strictEqual(booking1.slot_id, 'slot-future-1');
    assert.strictEqual(booking1.name, 'Ada Obi', 'Name must be trimmed');
    assert.strictEqual(booking1.email, 'ada@example.com', 'Email must be trimmed and lower case');
    assert.strictEqual(booking1.status, 'confirmed');
    assert.ok(booking1.created_at);
    console.log('✔ Booking created (201) with trimmed name & lower-cased email');

    // Lookup booking by ID
    const getRes = await req(`/bookings/${booking1.id}`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.id, booking1.id);
    assert.strictEqual(getRes.data.status, 'confirmed');
    console.log('✔ GET /bookings/:id looked up successfully');

    // Slot should now show available: false
    const slotsRes = await req('/slots', { headers: { 'X-API-Key': API_KEY } });
    const slot1 = slotsRes.data.slots.find(s => s.id === 'slot-future-1');
    assert.strictEqual(slot1.available, false, 'Booked slot must show available: false');
    console.log('✔ Slot availability correctly marked false after booking');
  }

  // ════════════════════════════════════════════════════════════
  // LEVEL 3: Double Booking Prevention & Concurrency & Cancellation
  // ════════════════════════════════════════════════════════════
  console.log('\n--- LEVEL 3: Concurrency & Cancellation ---');
  {
    // Try to book the same slot again
    const doubleRes = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({
        slot_id: 'slot-future-1',
        name: 'Another Person',
        email: 'person@example.com'
      })
    });
    assert.strictEqual(doubleRes.status, 409, 'Double booking must return 409');
    assert.ok(doubleRes.data.error);
    console.log('✔ Already booked slot returns 409');

    // Concurrent booking attempt on slot-future-2
    const promises = [
      req('/bookings', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: JSON.stringify({ slot_id: 'slot-future-2', name: 'User A', email: 'usera@example.com' })
      }),
      req('/bookings', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: JSON.stringify({ slot_id: 'slot-future-2', name: 'User B', email: 'userb@example.com' })
      }),
      req('/bookings', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: JSON.stringify({ slot_id: 'slot-future-2', name: 'User C', email: 'userc@example.com' })
      })
    ];

    const results = await Promise.all(promises);
    const statuses = results.map(r => r.status);
    const successCount = statuses.filter(s => s === 201).length;
    const conflictCount = statuses.filter(s => s === 409).length;

    assert.strictEqual(successCount, 1, 'Exactly one concurrent booking must succeed');
    assert.strictEqual(conflictCount, 2, 'All other concurrent bookings must receive 409');
    console.log('✔ Concurrent race condition test passed (1 success, 2 conflicts)');

    // Cancel booking1
    const cancelRes = await req(`/bookings/${booking1.id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.data.status, 'cancelled');
    console.log('✔ DELETE /bookings/:id cancels appointment');

    // Slot is available again
    const slotsAfterCancel = await req('/slots', { headers: { 'X-API-Key': API_KEY } });
    const freedSlot = slotsAfterCancel.data.slots.find(s => s.id === 'slot-future-1');
    assert.strictEqual(freedSlot.available, true, 'Slot must be freed after cancellation');
    console.log('✔ Slot freed and marked available: true again');

    // Cancelling already cancelled returns 409
    const reCancelRes = await req(`/bookings/${booking1.id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': API_KEY }
    });
    assert.strictEqual(reCancelRes.status, 409, 'Cancelling already cancelled returns 409');
    console.log('✔ Cancelling already cancelled returns 409');
  }

  // ════════════════════════════════════════════════════════════
  // LEVEL 4: Idempotency & Cursor Pagination
  // ════════════════════════════════════════════════════════════
  console.log('\n--- LEVEL 4: Idempotency & Cursor Pagination ---');
  {
    // Idempotent creation
    const idemKey = 'test-idem-key-100';
    const body1 = { slot_id: 'slot-future-1', name: 'Idem User', email: 'idem@example.com' };

    const firstIdemRes = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Idempotency-Key': idemKey },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(firstIdemRes.status, 201);
    const initialBookingId = firstIdemRes.data.id;

    // Retry with exact same body and key
    const retryIdemRes = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Idempotency-Key': idemKey },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(retryIdemRes.status, 201, 'Retried idempotent request returns 201');
    assert.strictEqual(retryIdemRes.data.id, initialBookingId, 'Must return same booking id');
    console.log('✔ Retried idempotent request returns same booking id without duplicate');

    // Reusing same key with different body -> 422
    const differentBody = { slot_id: 'slot-future-3', name: 'Different Name', email: 'idem@example.com' };
    const conflictIdemRes = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Idempotency-Key': idemKey },
      body: JSON.stringify(differentBody)
    });
    assert.strictEqual(conflictIdemRes.status, 422, 'Reused key with different body must return 422');
    console.log('✔ Idempotency key reused with different body returns 422');

    // Cursor pagination
    // Create multiple bookings for paginationUser
    await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'slot-future-3', name: 'Pager', email: 'pager@example.com' })
    });
    await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'slot-future-4', name: 'Pager', email: 'pager@example.com' })
    });
    await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'slot-future-5', name: 'Pager', email: 'PAGER@EXAMPLE.COM' })
    });

    // Page 1 with limit=2
    const page1Res = await req('/bookings?email=pager@example.com&limit=2', {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.strictEqual(page1Res.status, 200);
    assert.strictEqual(page1Res.data.bookings.length, 2);
    assert.ok(page1Res.data.next_cursor, 'Page 1 must have next_cursor');
    console.log('✔ Page 1 returned with limit=2 and valid next_cursor');

    // Page 2
    const page2Res = await req(`/bookings?email=PAGER@EXAMPLE.COM&limit=2&cursor=${page1Res.data.next_cursor}`, {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.strictEqual(page2Res.status, 200);
    assert.strictEqual(page2Res.data.bookings.length, 1);
    assert.strictEqual(page2Res.data.next_cursor, null, 'Last page must have next_cursor: null');
    console.log('✔ Page 2 returned remaining booking with next_cursor: null (case insensitive email matching)');

    // Invalid limit check
    const badLimitRes = await req('/bookings?email=pager@example.com&limit=100', {
      headers: { 'X-API-Key': API_KEY }
    });
    assert.strictEqual(badLimitRes.status, 400, 'Limit > 50 must return 400');
    console.log('✔ Invalid limit (>50) returns 400');
  }

  // ════════════════════════════════════════════════════════════
  // LEVEL 5: Rate Limiting
  // ════════════════════════════════════════════════════════════
  console.log('\n--- LEVEL 5: Rate Limiting ---');
  {
    const spamEmail = 'spammer@example.com';
    const innocentEmail = 'innocent@example.com';

    // 5 attempts should go through (even if failing validation or 404)
    for (let i = 1; i <= 5; i++) {
      const res = await req('/bookings', {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: JSON.stringify({ slot_id: 'non-existent', name: 'Spam', email: spamEmail })
      });
      assert.ok(res.status !== 429, `Attempt ${i} should not be 429`);
    }
    console.log('✔ 5 attempts allowed for spammer@example.com');

    // 6th attempt should be blocked with 429
    const blockedRes = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'non-existent', name: 'Spam', email: spamEmail })
    });
    assert.strictEqual(blockedRes.status, 429, '6th attempt must return 429');
    assert.ok(blockedRes.headers.get('retry-after'), 'Must include Retry-After header');
    const retryAfter = Number(blockedRes.headers.get('retry-after'));
    assert.ok(!isNaN(retryAfter) && retryAfter > 0, 'Retry-After must be a positive integer in seconds');
    console.log(`✔ 6th attempt blocked with 429 and Retry-After: ${retryAfter}s`);

    // Other emails aren't affected
    const otherRes = await req('/bookings', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY },
      body: JSON.stringify({ slot_id: 'non-existent', name: 'Innocent', email: innocentEmail })
    });
    assert.notStrictEqual(otherRes.status, 429, 'Other emails must not be affected by rate limit');
    console.log('✔ innocent@example.com is unaffected by spammer rate limit');
  }

  console.log('\n🎉 ALL 5 LEVELS VERIFIED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
