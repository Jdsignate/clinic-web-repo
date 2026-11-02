const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// In Vercel serverless functions, only /tmp is writable
const isVercel = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME || Boolean(process.env.LAMBDA_TASK_ROOT);
const SEED_DB_PATH = path.join(__dirname, 'clinic.db');
const DB_PATH = isVercel ? path.join('/tmp', 'clinic.db') : SEED_DB_PATH;

let db = null;

async function initDatabase() {
  if (db) return db;

  const SQL = await initSqlJs();

  // On Vercel, if /tmp/clinic.db doesn't exist yet but bundled clinic.db exists, copy it
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
      db = new SQL.Database(buffer);
    } catch (e) {
      console.warn('Could not read existing clinic.db, creating fresh database:', e.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  // Create tables according to OpenAPI spec
  db.run(`
    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL
    );
  `);

  db.run(`
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
  `);

  // Index for fast lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id, status);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_slots_start ON slots(start);`);

  // Seed default slots if none exist
  const countRes = queryOne('SELECT COUNT(*) AS count FROM slots');
  if (!countRes || countRes.count === 0) {
    seedDefaultSlots();
  }

  saveDatabase();
  return db;
}

function seedDefaultSlots() {
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

  const now = new Date();
  let slotIndex = 1;

  for (let dayOffset = 1; dayOffset <= 5; dayOffset++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + dayOffset);
    const dateStr = d.toISOString().split('T')[0];

    for (const provider of providers) {
      for (const t of times) {
        const slotId = `s${slotIndex++}`;
        const startIso = `${dateStr}T${t.start}:00Z`;
        const endIso = `${dateStr}T${t.end}:00Z`;
        execSql(
          'INSERT INTO slots (id, provider, start, end) VALUES (?, ?, ?, ?)',
          [slotId, provider, startIso, endIso]
        );
      }
    }
  }
}

function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('Failed to persist database to disk:', e);
    }
  }
}

function getDb() {
  return db;
}

function queryAll(sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function execSql(sql, params = []) {
  if (!db) return;
  if (params && params.length) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    db.run(sql);
  }
}

module.exports = {
  initDatabase,
  getDb,
  queryAll,
  queryOne,
  execSql,
  saveDatabase,
  seedDefaultSlots
};
