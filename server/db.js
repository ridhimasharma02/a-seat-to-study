// SQLite database: schema, first-run seed, and small helpers.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomInt } from 'node:crypto';
import { hashPassword } from './auth.js';
import { DEMO_ACCOUNTS, STAFF_ACCOUNTS, SPACES, MIN, targetShare } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  reg_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',   -- student | staff
  title TEXT,                             -- staff job title
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  block TEXT NOT NULL,
  kinds TEXT NOT NULL,
  layout TEXT NOT NULL,
  cols INTEGER NOT NULL,
  sort INTEGER NOT NULL,
  base REAL NOT NULL,
  blurb TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seats (
  id INTEGER PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  label TEXT NOT NULL,
  grp TEXT NOT NULL,
  pos INTEGER NOT NULL,
  power INTEGER NOT NULL DEFAULT 0,
  power_ok INTEGER NOT NULL DEFAULT 1,
  capacity INTEGER NOT NULL DEFAULT 1,
  code TEXT NOT NULL,
  UNIQUE (space_id, label)
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seat_id INTEGER NOT NULL REFERENCES seats(id),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  status TEXT NOT NULL,              -- reserved | checked_in | on_break | completed | cancelled | no_show | released
  checked_in_at INTEGER,
  break_started_at INTEGER,
  breaks_used INTEGER NOT NULL DEFAULT 0,
  ended_at INTEGER,
  end_reason TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  plan TEXT,                         -- demo behaviour only: 'noshow' | 'overrun'
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_seat ON bookings (seat_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS bookings_user ON bookings (user_id, status);
CREATE INDEX IF NOT EXISTS bookings_status ON bookings (status, start_at);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  seat_id INTEGER NOT NULL REFERENCES seats(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,              -- bag | socket | noise | other
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  staff_note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function openDb(file, { reset = false } = {}) {
  if (reset) for (const f of [file, file + '-wal', file + '-shm']) if (existsSync(f)) rmSync(f);
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  const cache = new Map();
  db.q = (sql) => {
    let st = cache.get(sql);
    if (!st) { st = db.prepare(sql); cache.set(sql, st); }
    return st;
  };
  // databases made by an older version get the newer columns
  const addColumn = (table, col, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addColumn('users', 'title', 'TEXT');
  addColumn('reports', 'resolved_by', 'INTEGER REFERENCES users(id)');
  addColumn('reports', 'staff_note', 'TEXT');
  if (db.q('SELECT COUNT(*) AS n FROM spaces').get().n === 0) seed(db);
  ensureStaff(db);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function getSetting(db, key, fallback) {
  const row = db.q('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setSetting(db, key, value) {
  db.q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
export const deskCode = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

// Small seeded random generator so the floor plans come out the same every time.
function seeded(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layoutSeats(sp, rnd) {
  const seats = [];
  const power = (chance) => {
    const has = rnd() < chance ? 1 : 0;
    return { power: has, power_ok: has && rnd() < 0.12 ? 0 : 1 };
  };
  if (sp.layout === 'tables6' || sp.layout === 'tables4') {
    const per = sp.layout === 'tables6' ? 6 : 4;
    for (let t = 0; t < sp.count; t++) {
      const grp = String.fromCharCode(65 + t);
      for (let p = 0; p < per; p++) seats.push({ label: `${grp}${p + 1}`, grp, pos: p, capacity: 1, ...power(0.42) });
    }
  } else if (sp.layout === 'carrels') {
    for (let i = 0; i < sp.count; i++) {
      const row = Math.floor(i / sp.cols);
      seats.push({ label: `Q${String(i + 1).padStart(2, '0')}`, grp: `Row ${row + 1}`, pos: i % sp.cols, capacity: 1, ...power(0.6) });
    }
  } else {
    for (let i = 0; i < sp.count; i++) seats.push({ label: `Room ${i + 1}`, grp: `Room ${i + 1}`, pos: 0, capacity: sp.capacity, power: 1, power_ok: 1 });
  }
  return seats;
}

// Staff accounts live in the same table, with role 'staff' and their Staff ID in reg_no.
function ensureStaff(db) {
  for (const s of STAFF_ACCOUNTS) {
    if (db.q('SELECT 1 FROM users WHERE reg_no = ?').get(s.staff_id)) continue;
    db.q("INSERT INTO users (reg_no, name, pass_hash, role, title, created_at) VALUES (?, ?, ?, 'staff', ?, ?)")
      .run(s.staff_id, s.name, hashPassword(s.password), s.title, Date.now());
  }
}

function seed(db) {
  const rnd = seeded(37);
  const now = Date.now();
  tx(db, () => {
    const addUser = db.q('INSERT INTO users (reg_no, name, pass_hash, role, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    addUser.run(DEMO_ACCOUNTS.student.reg_no, DEMO_ACCOUNTS.student.name, hashPassword(DEMO_ACCOUNTS.student.password), 'student', 0, now);
    // Simulated students who fill the seats. They can't log in.
    for (let i = 1; i <= 120; i++) addUser.run(`demo-${String(i).padStart(3, '0')}`, `Demo student ${i}`, 'disabled', 'student', 1, now);

    const addSpace = db.q('INSERT INTO spaces (id, name, area, block, kinds, layout, cols, sort, base, blurb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const addSeat = db.q('INSERT INTO seats (space_id, label, grp, pos, power, power_ok, capacity, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    SPACES.forEach((sp, i) => {
      addSpace.run(sp.id, sp.name, sp.area, sp.block, sp.kinds.join(','), sp.layout, sp.cols, i, sp.base, sp.blurb);
      for (const s of layoutSeats(sp, rnd)) addSeat.run(sp.id, s.label, s.grp, s.pos, s.power, s.power_ok, s.capacity, deskCode());
    });
    setSetting(db, 'demo_activity', '1');
  });
  seedHistory(db, rnd, now);
}

// Two weeks of past bookings by the simulated students, so the Insights page has something to show.
function seedHistory(db, rnd, now) {
  const demoIds = db.q('SELECT id FROM users WHERE is_demo = 1').all().map((r) => r.id);
  const seats = db.q('SELECT seats.id, spaces.base FROM seats JOIN spaces ON spaces.id = seats.space_id').all();
  const add = db.q(`INSERT INTO bookings (user_id, seat_id, start_at, end_at, status, checked_in_at, ended_at, end_reason, is_demo, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  tx(db, () => {
    for (let d = 14; d >= 1; d--) {
      const day = new Date(today); day.setDate(day.getDate() - d);
      const open = new Date(day); open.setHours(8, 0, 0, 0);
      const close = new Date(day); close.setHours(22, 30, 0, 0);
      for (const seat of seats) {
        let t = open.getTime();
        while (t < close.getTime()) {
          const share = targetShare(seat.base, new Date(t).getHours());
          if (rnd() < Math.min(0.95, share * 0.95)) {
            const start = t + Math.floor(rnd() * 4) * 5 * MIN;
            const end = start + (2 + Math.floor(rnd() * 5)) * 30 * MIN;
            const user = demoIds[Math.floor(rnd() * demoIds.length)];
            if (rnd() < 0.08) {
              add.run(user, seat.id, start, end, 'no_show', null, start + 15 * MIN, 'Not checked in within 15 minutes', start - 30 * MIN);
            } else {
              const checkedIn = start + Math.floor(rnd() * 10) * MIN;
              const leftEarly = rnd() < 0.3 ? Math.floor(rnd() * (end - start) * 0.5) : 0;
              add.run(user, seat.id, start, end, 'completed', checkedIn, end - leftEarly, leftEarly ? 'Checked out' : 'Time ended', start - 30 * MIN);
            }
            t = end + (1 + Math.floor(rnd() * 6)) * 10 * MIN;
          } else {
            t += 60 * MIN;
          }
        }
      }
    }
  });
}
