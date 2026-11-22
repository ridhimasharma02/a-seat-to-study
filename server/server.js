// A Seat to Study: web server and JSON API. No dependencies; needs Node 22.13 or newer.
//   npm start            start on http://localhost:3000
//   npm run reset        wipe the database and start fresh
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { openDb, tx, getSetting, setSetting } from './db.js';
import { RULES, MIN, DEMO_ACCOUNTS, STAFF_ACCOUNTS } from './config.js';
import { hashPassword, verifyPassword, newToken, parseCookies } from './auth.js';
import {
  HttpError, seatStates, spaceSummary, bookingView, createBooking, checkIn, startBreak, endBreak,
  checkOut, cancel, releaseSeatNow, sweep, spaceOfSeat,
} from './bookings.js';
import { simulate } from './sim.js';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 7;

const db = openDb(process.env.DB_FILE || join(ROOT, 'data', 'seat-to-study.db'), { reset: process.argv.includes('--reset') });
sweep(db, Date.now());
if (getSetting(db, 'demo_activity', '1') === '1') simulate(db, Date.now(), { initial: true });

// ---------- live updates (Server-Sent Events) ----------
const streams = new Set();
function broadcast(spaceIds) {
  const ids = [...spaceIds].filter(Boolean);
  if (!ids.length) return;
  const msg = `event: update\ndata: ${JSON.stringify({ spaces: ids, at: Date.now() })}\n\n`;
  for (const res of streams) res.write(msg);
}
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 25_000).unref();

setInterval(() => {
  const now = Date.now();
  const changed = sweep(db, now);
  if (getSetting(db, 'demo_activity', '1') === '1') for (const id of simulate(db, now)) changed.add(id);
  insightsCache = null;
  broadcast(changed);
}, 15_000).unref();

// ---------- tiny router ----------
const routes = [];
const route = (method, path, handler, opts = {}) =>
  routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).sts;
  if (!token) return null;
  const row = db.q(`SELECT u.id, u.reg_no, u.name, u.role, u.title FROM sessions s JOIN users u ON u.id = s.user_id
                    WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
  return row || null;
}
const needUser = (user) => { if (!user) throw new HttpError(401, 'Please log in first.'); return user; };
const needStaff = (user) => { needUser(user); if (user.role !== 'staff') throw new HttpError(403, 'Staff only.'); return user; };

async function readJson(req) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return {};
  if (!(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new HttpError(413, 'Too much data.'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

// ---------- auth ----------
// Only wrong passwords count towards a short lockout, separately for each login page.
const failures = new Map();
function checkLockout(key) {
  const a = failures.get(key);
  if (a && a.until > Date.now() && a.n >= 8) throw new HttpError(429, `Too many wrong tries. Wait ${Math.ceil((a.until - Date.now()) / 1000)} seconds and try again.`);
}
function recordFailure(key) {
  const now = Date.now(), a = failures.get(key);
  if (!a || a.until < now) failures.set(key, { n: 1, until: now + 60_000 }); else a.n++;
}
function limitLogin(ip) { // registrations: a simple per-minute cap
  const key = `register:${ip}`; checkLockout(key); recordFailure(key);
}
// A password copied with a stray space before or after it still works.
const passwordMatches = (pw, hash) => verifyPassword(pw, hash) || (pw.trim() !== pw && verifyPassword(pw.trim(), hash));
function startSession(userId) {
  const token = newToken();
  db.q('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_DAYS * 86_400_000);
  return { 'Set-Cookie': `sts=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}` };
}
const publicUser = (u) => u && (u.role === 'staff'
  ? { id: u.id, name: u.name, staff_id: u.reg_no, title: u.title, role: 'staff' }
  : { id: u.id, name: u.name, reg_no: u.reg_no, role: 'student' });

// Only these API routes work without logging in; everything else needs an account.
route('GET', '/api/meta', () => ({ now: Date.now(), rules: RULES }), { public: true });
route('GET', '/api/me', ({ user }) => ({ user: publicUser(user) }), { public: true });

route('POST', '/api/register', ({ body, req }) => {
  limitLogin(req.socket.remoteAddress);
  const name = String(body.name || '').trim();
  const reg = String(body.reg_no || '').trim();
  const pw = String(body.password || '');
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Enter your name.');
  if (!/^\d{5,12}$/.test(reg)) throw new HttpError(400, 'Registration number should be 5 to 12 digits.');
  if (pw.length < 6) throw new HttpError(400, 'Password needs at least 6 characters.');
  if (pw !== pw.trim()) throw new HttpError(400, "A password can't start or end with a space.");
  if (db.q('SELECT 1 FROM users WHERE reg_no = ?').get(reg)) throw new HttpError(409, 'That registration number already has an account. Log in instead.');
  const r = db.q("INSERT INTO users (reg_no, name, pass_hash, role, created_at) VALUES (?, ?, ?, 'student', ?)").run(reg, name, hashPassword(pw), Date.now());
  const row = db.q('SELECT id, reg_no, name, role FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
  return { status: 201, body: { user: publicUser(row) }, headers: startSession(row.id) };
}, { public: true });

route('POST', '/api/login', ({ body, req }) => {
  const key = `student:${req.socket.remoteAddress}:${String(body.reg_no || '').trim()}`;
  checkLockout(key);
  const row = db.q('SELECT * FROM users WHERE reg_no = ? AND is_demo = 0').get(String(body.reg_no || '').trim());
  if (!row || !passwordMatches(String(body.password || ''), row.pass_hash)) {
    recordFailure(key);
    throw new HttpError(401, 'Registration number or password is wrong. Passwords are case-sensitive.');
  }
  if (row.role !== 'student') throw new HttpError(403, 'This is the student login. Library staff, please use the staff login page.');
  failures.delete(key);
  return { body: { user: publicUser(row) }, headers: startSession(row.id) };
}, { public: true });

// Staff have their own login page and endpoint, which refuses student accounts.
route('POST', '/api/staff/login', ({ body, req }) => {
  const id = String(body.staff_id || '').trim();
  const key = `staff:${req.socket.remoteAddress}:${id.toUpperCase()}`; // each Staff ID has its own lockout
  checkLockout(key);
  const row = db.q('SELECT * FROM users WHERE reg_no = ? AND is_demo = 0').get(id.toUpperCase())
    || db.q('SELECT * FROM users WHERE reg_no = ? AND is_demo = 0').get(id);
  if (!row || !passwordMatches(String(body.password || ''), row.pass_hash)) {
    recordFailure(key);
    const pw = String(body.password || '');
    // the server log says why a login failed (never the password itself), so problems can be traced
    console.log(`[staff login] failed for "${id}": ${!row ? 'no account with this ID' : 'wrong password'} (password length ${pw.length})`);
    if (!row && /^\d+$/.test(id)) throw new HttpError(401, 'That looks like a student registration number. Staff log in with a Staff ID such as LIB001.');
    if (!row) throw new HttpError(401, `There is no staff account with the ID "${id}". Staff IDs look like LIB001.`);
    if (row.role !== 'staff') throw new HttpError(401, 'Staff ID or password is wrong.');
    throw new HttpError(401, `That password is wrong for ${row.reg_no}. Passwords are case-sensitive: press Show to check what you typed.`);
  }
  if (row.role !== 'staff') throw new HttpError(403, 'This login is for library staff only. Students, please use the student login.');
  failures.delete(key);
  return { body: { user: publicUser(row) }, headers: startSession(row.id) };
}, { public: true });

// Change your own password (students and staff). Logs out your other devices.
route('POST', '/api/password', ({ body, req, user }) => {
  const key = `password:${user.id}`;
  checkLockout(key);
  const row = db.q('SELECT pass_hash FROM users WHERE id = ?').get(user.id);
  const current = String(body.current || ''), next = String(body.next || '');
  if (!passwordMatches(current, row.pass_hash)) { recordFailure(key); throw new HttpError(400, 'Your current password is wrong.'); }
  if (next.length < 8) throw new HttpError(400, 'The new password needs at least 8 characters.');
  if (next !== next.trim()) throw new HttpError(400, "A password can't start or end with a space.");
  if (next === current) throw new HttpError(400, 'Pick a new password that is different from the current one.');
  db.q('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  db.q('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, parseCookies(req.headers.cookie).sts);
  failures.delete(key);
  return { ok: true };
}, { anyRole: true });

route('POST', '/api/logout', ({ req }) => {
  const token = parseCookies(req.headers.cookie).sts;
  if (token) db.q('DELETE FROM sessions WHERE token = ?').run(token);
  return { body: { ok: true }, headers: { 'Set-Cookie': 'sts=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' } };
}, { public: true });

// ---------- spaces ----------
function windowFrom(query, now) {
  let start = Number(query.start) || now;
  if (start < now) start = now;
  const dur = RULES.DURATIONS_MIN.includes(Number(query.dur)) ? Number(query.dur) : 60;
  return { from: start, to: start + dur * MIN, dur };
}
const allSpaces = () => db.q('SELECT * FROM spaces ORDER BY sort').all();

route('GET', '/api/spaces', ({ query, user }) => {
  const now = Date.now();
  const win = windowFrom(query, now);
  const kinds = String(query.kinds || '').split(',').filter(Boolean);
  const q = String(query.q || '').trim().toLowerCase();
  let list = allSpaces();
  if (kinds.length) list = list.filter((sp) => kinds.some((k) => sp.kinds.split(',').includes(k)));
  if (q) list = list.filter((sp) => `${sp.name} ${sp.area} ${sp.block}`.toLowerCase().includes(q));
  let spaces = list.map((sp) => spaceSummary(db, sp, win.from, win.to, now, user?.id));
  if (query.power === '1') spaces = spaces.filter((s) => s.power_free > 0);
  return { window: win, spaces };
});

route('GET', '/api/spaces/:id', ({ params, query, user }) => {
  const sp = db.q('SELECT * FROM spaces WHERE id = ?').get(params.id);
  if (!sp) throw new HttpError(404, 'Study space not found.');
  const now = Date.now();
  const win = windowFrom(query, now);
  return {
    window: win,
    space: { ...spaceSummary(db, sp, win.from, win.to, now, user?.id), cols: sp.cols },
    seats: seatStates(db, sp.id, win.from, win.to, now, user?.id || 0),
  };
});

// ---------- bookings ----------
route('GET', '/api/bookings/mine', ({ user }) => {
  needUser(user);
  const ids = (sql) => db.q(sql).all(user.id).map((r) => bookingView(db, r.id));
  return {
    active: ids("SELECT id FROM bookings WHERE user_id = ? AND status IN ('reserved','checked_in','on_break') ORDER BY start_at"),
    past: ids("SELECT id FROM bookings WHERE user_id = ? AND status NOT IN ('reserved','checked_in','on_break') ORDER BY start_at DESC LIMIT 12"),
  };
});

route('POST', '/api/bookings', ({ user, body }) => {
  needUser(user);
  const now = Date.now();
  const start = body.start === 'now' || !body.start ? now : Number(body.start);
  const id = createBooking(db, { userId: user.id, seatId: Number(body.seat_id), start, durationMin: Number(body.duration), now });
  const view = bookingView(db, id);
  broadcast([view.space.id]);
  return { status: 201, body: { booking: view } };
});

const act = (fn) => ({ user, params, body }) => {
  needUser(user);
  const seatId = fn(Number(params.id), user.id, body, Date.now());
  broadcast([spaceOfSeat(db, seatId)]);
  return { booking: bookingView(db, Number(params.id)) };
};
route('POST', '/api/bookings/:id/checkin', act((id, uid, body, now) => checkIn(db, id, uid, body.code, now)));
route('POST', '/api/bookings/:id/break', act((id, uid, body, now) => startBreak(db, id, uid, now)));
route('POST', '/api/bookings/:id/resume', act((id, uid) => endBreak(db, id, uid)));
route('POST', '/api/bookings/:id/checkout', act((id, uid, body, now) => checkOut(db, id, uid, now)));
route('POST', '/api/bookings/:id/cancel', act((id, uid, body, now) => cancel(db, id, uid, now)));

// For demos without a printed sticker: the owner of a reserved booking can reveal the desk code.
route('GET', '/api/bookings/:id/desk-code', ({ user, params }) => {
  needUser(user);
  const b = db.q('SELECT b.user_id, b.status, s.code, s.label FROM bookings b JOIN seats s ON s.id = b.seat_id WHERE b.id = ?').get(Number(params.id));
  if (!b || b.user_id !== user.id) throw new HttpError(404, 'Booking not found.');
  if (b.status !== 'reserved') throw new HttpError(409, 'Only needed before you check in.');
  return { code: b.code, seat: b.label };
});

// QR sticker link: /checkin?seat=ID&code=XXXX lands here after login.
route('POST', '/api/checkin', ({ user, body }) => {
  needUser(user);
  const now = Date.now();
  const b = db.q(`SELECT id FROM bookings WHERE user_id = ? AND seat_id = ? AND status = 'reserved'
                  AND start_at - ? <= ? AND start_at + ? > ? ORDER BY start_at LIMIT 1`)
    .get(user.id, Number(body.seat_id), RULES.CHECKIN_EARLY_MIN * MIN, now, RULES.CHECKIN_GRACE_MIN * MIN, now);
  if (!b) throw new HttpError(404, 'You have no booking for this desk right now. Reserve it first, or check My Bookings.');
  const seatId = checkIn(db, b.id, user.id, body.code, now);
  broadcast([spaceOfSeat(db, seatId)]);
  return { booking: bookingView(db, b.id) };
});

// ---------- reports ----------
const REASONS = {
  bag: 'Bag or belongings on the seat, nobody there',
  socket: 'Power socket not working',
  noise: 'Too noisy',
  other: 'Something else',
};
route('GET', '/api/reports/reasons', () => ({ reasons: REASONS }), { anyRole: true });

route('POST', '/api/reports', ({ user, body }) => {
  needUser(user);
  const seat = db.q('SELECT id FROM seats WHERE id = ?').get(Number(body.seat_id));
  if (!seat) throw new HttpError(400, 'Pick the seat you are reporting.');
  if (!REASONS[body.reason]) throw new HttpError(400, 'Pick what is wrong.');
  const note = String(body.note || '').trim().slice(0, 500);
  if (db.q("SELECT 1 FROM reports WHERE seat_id = ? AND user_id = ? AND status = 'open'").get(seat.id, user.id)) {
    throw new HttpError(409, 'You already reported this seat. Staff will check it soon.');
  }
  const r = db.q('INSERT INTO reports (seat_id, user_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?)').run(seat.id, user.id, body.reason, note || null, Date.now());
  broadcast([spaceOfSeat(db, seat.id), 'reports']);
  return { status: 201, body: { id: Number(r.lastInsertRowid) } };
});

const reportRows = (where, ...args) => db.q(`SELECT r.*, s.label AS seat_label, s.power, s.power_ok, sp.id AS space_id, sp.name AS space_name, sp.area AS space_area,
    u.name AS user_name, h.name AS handler_name, h.title AS handler_title
  FROM reports r JOIN seats s ON s.id = r.seat_id JOIN spaces sp ON sp.id = s.space_id JOIN users u ON u.id = r.user_id
  LEFT JOIN users h ON h.id = r.resolved_by
  ${where} ORDER BY COALESCE(r.resolved_at, r.created_at) DESC LIMIT 60`).all(...args).map((r) => ({ ...r, reason_text: REASONS[r.reason] }));

// What is happening at a seat right now, so staff know what they will find there.
function seatNow(seatId, now) {
  const b = db.q(`SELECT b.status, b.start_at, b.end_at, b.break_started_at, u.name, u.is_demo FROM bookings b JOIN users u ON u.id = b.user_id
                  WHERE b.seat_id = ? AND b.status IN ('reserved','checked_in','on_break') AND b.start_at <= ? AND b.end_at > ? LIMIT 1`).get(seatId, now, now);
  if (!b) return { status: 'free' };
  return { status: b.status, student: b.name, is_demo: b.is_demo, until: b.end_at,
    back_by: b.break_started_at ? b.break_started_at + RULES.BREAK_MAX_MIN * MIN : null,
    checkin_by: b.status === 'reserved' ? b.start_at + RULES.CHECKIN_GRACE_MIN * MIN : null };
}

route('GET', '/api/reports/mine', ({ user }) => { needUser(user); return { reports: reportRows('WHERE r.user_id = ?', user.id) }; });

// ---------- staff ----------
route('GET', '/api/staff/overview', ({ user }) => {
  needStaff(user);
  const now = Date.now();
  const spaces = allSpaces().map((sp) => spaceSummary(db, sp, now, now + 1, now));
  const active = db.q(`SELECT b.id FROM bookings b WHERE b.status IN ('reserved','checked_in','on_break') AND b.start_at <= ?
                       ORDER BY b.status = 'on_break' DESC, b.start_at LIMIT 400`).all(now)
    .map((r) => {
      const v = bookingView(db, r.id);
      const u = db.q('SELECT name, is_demo FROM users WHERE id = ?').get(v.user_id);
      return { ...v, user_name: u.name, is_demo: u.is_demo };
    });
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  return {
    spaces, active,
    reports: reportRows("WHERE r.status = 'open'").map((r) => ({ ...r, seat_now: seatNow(r.seat_id, now) })),
    recent_reports: reportRows("WHERE r.status != 'open'").slice(0, 25),
    handled_today: db.q("SELECT COUNT(*) AS n FROM reports WHERE status = 'resolved' AND resolved_at >= ?").get(dayStart.getTime()).n,
    handled_by_me_today: db.q("SELECT COUNT(*) AS n FROM reports WHERE status = 'resolved' AND resolved_by = ? AND resolved_at >= ?").get(user.id, dayStart.getTime()).n,
    broken_sockets: db.q(`SELECT s.id, s.label, sp.name AS space_name, sp.area AS space_area FROM seats s JOIN spaces sp ON sp.id = s.space_id
                          WHERE s.power = 1 AND s.power_ok = 0 ORDER BY sp.sort, s.id`).all(),
    demo_activity: getSetting(db, 'demo_activity', '1') === '1',
  };
});

route('POST', '/api/staff/reports/:id/resolve', ({ user, params, body }) => {
  needStaff(user);
  const r = db.q('SELECT * FROM reports WHERE id = ?').get(Number(params.id));
  if (!r || r.status !== 'open') throw new HttpError(404, 'Report not found or already handled.');
  const now = Date.now();
  let resolution;
  tx(db, () => {
    if (body.action === 'release') {
      const n = releaseSeatNow(db, r.seat_id, now, 'Released by library staff after a report');
      resolution = n ? 'Seat released by staff' : 'Seat was already free';
    } else if (body.action === 'socket') {
      db.q('UPDATE seats SET power_ok = 0 WHERE id = ?').run(r.seat_id);
      resolution = 'Socket marked as not working';
    } else if (body.action === 'dismiss') {
      resolution = 'Checked: no problem found';
    } else throw new HttpError(400, 'Unknown action.');
    const note = String(body.note || '').trim().slice(0, 300) || null;
    db.q("UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ?, staff_note = ? WHERE id = ?").run(resolution, now, user.id, note, r.id);
  });
  broadcast([spaceOfSeat(db, r.seat_id), 'reports']);
  return { ok: true, resolution };
});

route('POST', '/api/staff/seats/:id/release', ({ user, params }) => {
  needStaff(user);
  const n = releaseSeatNow(db, Number(params.id), Date.now(), 'Released by library staff');
  broadcast([spaceOfSeat(db, Number(params.id))]);
  return { released: n };
});

route('POST', '/api/staff/seats/:id/power', ({ user, params, body }) => {
  needStaff(user);
  db.q('UPDATE seats SET power_ok = ? WHERE id = ? AND power = 1').run(body.ok ? 1 : 0, Number(params.id));
  broadcast([spaceOfSeat(db, Number(params.id))]);
  return { ok: true };
});

route('POST', '/api/staff/settings', ({ user, body }) => {
  needStaff(user);
  if ('demo_activity' in body) setSetting(db, 'demo_activity', body.demo_activity ? '1' : '0');
  return { demo_activity: getSetting(db, 'demo_activity', '1') === '1' };
});

route('GET', '/api/staff/spaces/:id', ({ params }) => {
  const sp = db.q('SELECT * FROM spaces WHERE id = ?').get(params.id);
  if (!sp) throw new HttpError(404, 'Study space not found.');
  const now = Date.now();
  return { space: { ...spaceSummary(db, sp, now, now + 1, now), cols: sp.cols }, seats: seatStates(db, sp.id, now, now + 1, now, 0) };
});

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

route('GET', '/api/staff/desk-codes', ({ user, query }) => {
  needStaff(user);
  const sp = db.q('SELECT id, name, area FROM spaces WHERE id = ?').get(String(query.space || ''));
  if (!sp) throw new HttpError(404, 'Pick a study space.');
  return {
    space: sp,
    base_url: process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}`,
    seats: db.q('SELECT id, label, code FROM seats WHERE space_id = ? ORDER BY id').all(sp.id),
  };
});

// ---------- insights ----------
let insightsCache = null;
function busyTimes() {
  if (insightsCache && Date.now() - insightsCache.at < 5 * MIN) return insightsCache.data;
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 14);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const seatCount = new Map(db.q('SELECT space_id, COUNT(*) AS n FROM seats GROUP BY space_id').all().map((r) => [r.space_id, r.n]));
  const days = Math.round((today - since) / 86_400_000);
  const hours = Array.from({ length: 15 }, (_, i) => i + 8); // 8 am to 10 pm
  const tally = new Map();
  const rows = db.q(`SELECT s.space_id, b.checked_in_at, COALESCE(b.ended_at, b.end_at) AS left_at FROM bookings b JOIN seats s ON s.id = b.seat_id
                     WHERE b.checked_in_at IS NOT NULL AND b.start_at >= ? AND b.start_at < ?`).all(since.getTime(), today.getTime());
  for (const r of rows) {
    const day0 = new Date(r.checked_in_at); day0.setHours(0, 0, 0, 0);
    for (const h of hours) {
      const t = day0.getTime() + (h * 60 + 30) * MIN;
      if (r.checked_in_at <= t && r.left_at > t) {
        const key = `${r.space_id}|${h}`; tally.set(key, (tally.get(key) || 0) + 1);
      }
    }
  }
  const data = {};
  for (const [spaceId, n] of seatCount) {
    data[spaceId] = hours.map((h) => ({ hour: h, pct: Math.round(((tally.get(`${spaceId}|${h}`) || 0) / (n * days)) * 100) }));
  }
  insightsCache = { at: Date.now(), data: { days, hours: data } };
  return insightsCache.data;
}

route('GET', '/api/insights', () => {
  const now = Date.now();
  const busy = busyTimes();
  return {
    based_on_days: busy.days,
    spaces: allSpaces().map((sp) => {
      const s = spaceSummary(db, sp, now, now + 1, now);
      const hourly = busy.hours[sp.id] || [];
      const sorted = [...hourly].sort((a, b) => a.pct - b.pct);
      return { ...s, pct_now: Math.round((s.in_use_now / s.total) * 100), hourly, quietest: sorted[0], busiest: sorted[sorted.length - 1] };
    }),
  };
});

// ---------- HTTP server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
};

async function serveStatic(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  if (!extname(path)) path = '/index.html'; // single-page app: every page route gets the app shell
  const file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC + sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);

  if (url.pathname === '/api/stream' && req.method === 'GET') {
    if (!currentUser(req)) return sendJson(res, 401, { error: 'Please log in first.' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }

  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Not found.');
    const params = url.pathname.match(r.re).groups || {};
    const user = currentUser(req);
    if (!r.public && !user) throw new HttpError(401, 'Please log in first.');
    if (!r.public && !r.anyRole) {
      const need = url.pathname.startsWith('/api/staff/') ? 'staff' : 'student';
      if (user.role !== need) throw new HttpError(403, need === 'staff' ? 'Only library staff can do this.' : 'Staff accounts cannot use the student pages.');
    }
    const body = await readJson(req);
    const out = await r.handler({ req, res, params, body, query: Object.fromEntries(url.searchParams), user });
    if (out && out.body !== undefined) sendJson(res, out.status || 200, out.body, out.headers);
    else sendJson(res, 200, out ?? { ok: true });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    sendJson(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on the server.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nA Seat to Study is running`);
  console.log(`  on this computer:  http://localhost:${PORT}`);
  console.log(`  on your Wi-Fi:     http://${lanAddress()}:${PORT}  (open on a phone to scan desk QR codes)`);
  console.log(`  student login: /login · staff login: /staff/login (demo accounts are in README.md: student ${DEMO_ACCOUNTS.student.reg_no}, staff ${STAFF_ACCOUNTS.map((s) => s.staff_id).join(', ')})\n`);
});
