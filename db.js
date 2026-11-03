const { Pool } = require('pg');
const initSqlJs = require('sql.js/dist/sql-wasm-inline.js');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = Boolean(DATABASE_URL);

let pgPool = null;
let sqliteDb = null;
let initialized = false;

// Convert '?' placeholders to '$1, $2, ...' for Postgres
function toPgSql(sql) {
  let idx = 1;
  return sql.replace(/\?/g, () => `$${idx++}`);
}

async function initDatabase() {
  if (initialized) return;

  if (isPostgres) {
    // ═══════════════════════════════════════════════════════════════
    // SUPABASE / POSTGRESQL INITIALIZATION
    // ═══════════════════════════════════════════════════════════════
    console.log('Connecting to PostgreSQL / Supabase...');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS slots (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          start TEXT NOT NULL,
          "end" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          slot_id TEXT NOT NULL REFERENCES slots(id),
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          idempotency_key TEXT UNIQUE,
          idempotency_body TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
        CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id, status);
        CREATE INDEX IF NOT EXISTS idx_slots_start ON slots(start);

        -- Partial unique index guarantees Level 3 concurrency at DB level
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_confirmed_booking_per_slot
        ON bookings (slot_id) WHERE status = 'confirmed';
      `);

      const countRes = await client.query('SELECT COUNT(*) AS count FROM slots');
      const count = parseInt(countRes.rows[0].count, 10);
      if (count === 0) {
        console.log('Seeding initial slots in Supabase...');
        await seedDefaultSlotsPg(client);
      }
    } finally {
      client.release();
    }
    console.log('PostgreSQL / Supabase initialized successfully.');
  } else {
    // ═══════════════════════════════════════════════════════════════
    // LOCAL SQLITE INITIALIZATION (FALLBACK)
    // ═══════════════════════════════════════════════════════════════
    console.log('Using SQLite fallback for local development...');
    const isVercel = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const SEED_DB_PATH = path.join(__dirname, 'clinic.db');
    const DB_PATH = isVercel ? path.join('/tmp', 'clinic.db') : SEED_DB_PATH;

    const SQL = await initSqlJs();

    if (isVercel && !fs.existsSync(DB_PATH) && fs.existsSync(SEED_DB_PATH)) {
      try {
        fs.copyFileSync(SEED_DB_PATH, DB_PATH);
      } catch (e) {
        console.warn('Could not copy bundled clinic.db to /tmp:', e.message);
      }
    }

    if (fs.existsSync(DB_PATH)) {
      try {
        const buffer = fs.readFileSync(DB_PATH);
        sqliteDb = new SQL.Database(buffer);
      } catch (e) {
        sqliteDb = new SQL.Database();
      }
    } else {
      sqliteDb = new SQL.Database();
    }

    sqliteDb.run('PRAGMA foreign_keys = ON');

    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        start TEXT NOT NULL,
        "end" TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        idempotency_body TEXT,
        FOREIGN KEY (slot_id) REFERENCES slots(id)
      );

      CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
      CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id, status);
      CREATE INDEX IF NOT EXISTS idx_slots_start ON slots(start);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_confirmed_booking_per_slot
      ON bookings (slot_id) WHERE status = 'confirmed';
    `);

    const countRes = queryOneSqlite('SELECT COUNT(*) AS count FROM slots');
    if (!countRes || countRes.count === 0) {
      seedDefaultSlotsSqlite();
    }

    saveDatabase();
  }

  initialized = true;
}

// ═════════════════════════════════════════════════════════════════
// SEED HELPERS
// ═════════════════════════════════════════════════════════════════
function getDefaultSlotsData() {
  const providers = ['Dr Ade', 'Dr Smith', 'Dr Patel'];
  const times = [
    { start: '09:00', end: '09:30' },
    { start: '09:30', end: '10:00' },
    { start: '10:00', end: '10:30' },
    { start: '10:30', end: '11:00' },
    { start: '11:00', end: '11:30' },
    { start: '14:00', end: '14:30' },
    { start: '14:30', end: '15:00' },
    { start: '15:00', end: '15:30' }
  ];

  const slots = [];
  const now = new Date();
  let slotIndex = 1;

  for (let dayOffset = 1; dayOffset <= 5; dayOffset++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + dayOffset);
    const dateStr = d.toISOString().split('T')[0];

    for (const provider of providers) {
      for (const t of times) {
        slots.push({
          id: `s${slotIndex++}`,
          provider,
          start: `${dateStr}T${t.start}:00Z`,
          end: `${dateStr}T${t.end}:00Z`
        });
      }
    }
  }
  return slots;
}

async function seedDefaultSlotsPg(client) {
  const slots = getDefaultSlotsData();
  for (const s of slots) {
    await client.query(
      'INSERT INTO slots (id, provider, start, "end") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [s.id, s.provider, s.start, s.end]
    );
  }
}

function seedDefaultSlotsSqlite() {
  const slots = getDefaultSlotsData();
  const stmt = sqliteDb.prepare('INSERT INTO slots (id, provider, start, "end") VALUES (?, ?, ?, ?)');
  for (const s of slots) {
    stmt.bind([s.id, s.provider, s.start, s.end]);
    stmt.step();
    stmt.reset();
  }
  stmt.free();
}

// ═════════════════════════════════════════════════════════════════
// QUERY METHODS (ASYNC FOR BOTH POSTGRES & SQLITE)
// ═════════════════════════════════════════════════════════════════
async function queryAll(sql, params = []) {
  if (isPostgres) {
    const pgSql = toPgSql(sql);
    const res = await pgPool.query(pgSql, params);
    return res.rows;
  } else {
    return queryAllSqlite(sql, params);
  }
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function execSql(sql, params = []) {
  if (isPostgres) {
    const pgSql = toPgSql(sql);
    return await pgPool.query(pgSql, params);
  } else {
    execSqlSqlite(sql, params);
  }
}

// SQLite internal helpers
function queryAllSqlite(sql, params = []) {
  if (!sqliteDb) return [];
  const stmt = sqliteDb.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOneSqlite(sql, params = []) {
  const rows = queryAllSqlite(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function execSqlSqlite(sql, params = []) {
  if (!sqliteDb) return;
  if (params && params.length) {
    const stmt = sqliteDb.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    sqliteDb.run(sql);
  }
}

function saveDatabase() {
  if (!isPostgres && sqliteDb) {
    try {
      const isVercel = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
      const DB_PATH = isVercel ? path.join('/tmp', 'clinic.db') : path.join(__dirname, 'clinic.db');
      const data = sqliteDb.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      // Ignored in read-only environments
    }
  }
}

module.exports = {
  initDatabase,
  queryAll,
  queryOne,
  execSql,
  saveDatabase,
  isPostgres: () => isPostgres,
};
