// A Seat to Study: web server and JSON API. Needs Node 22.13 or newer.
// Runs two ways: as a normal server (npm start), or on Vercel, where api/index.js calls handle() for each request.
//   npm start                  start on http://localhost:3000
//   npm run reset              wipe the database and start fresh
//   npm run connect-supabase   store your Supabase connection in .env (then npm start uses Supabase)
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { openDb, getSetting, setSetting } from './db.js';
import { RULES, MIN, DEMO_ACCOUNTS, STAFF_ACCOUNTS } from './config.js';
import { hashPassword, verifyPassword, newToken, parseCookies } from './auth.js';
import {
  HttpError, seatStates, spaceSummaries, bookingView, bookingViews, createBooking, checkIn, startBreak, endBreak,
  checkOut, cancel, releaseSeatNow, sweep, spaceOfSeat, ACTIVE_SQL,
} from './bookings.js';
import { simulate } from './sim.js';
import { openStore } from './store.js';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = 7;

// On Vercel there is no always-on server: no background timer, no open live-update connections, no disk to write.
const ON_VERCEL = !!process.env.VERCEL;

let db, initError = null;
async function init() {
  process.env.DATABASE_URL="postgresql://postgres.hvaafnuoqbpsyhyqykvv:shxRii123%40RDS@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"; 
  postgresql://postgres.hvaafnuoqbpsyhyqykvv:shxRii123%40RDS@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres
  if (ON_VERCEL && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. In Vercel open your project > Settings > Environment Variables, add DATABASE_URL with your Supabase connection string, then redeploy.');
  }
  db = await openDb({
    url: process.env.DATABASE_URL,
    file: process.env.DB_FILE || join(ROOT, 'data', 'seat-to-study.db'),
    reset: process.argv.includes('--reset'),
  });
  await sweep(db, Date.now());
  if ((await getSetting(db, 'demo_activity', '1')) === '1') await simulate(db, Date.now(), { initial: true });
}
const ready = init().catch((e) => {
  initError = e;
  console.error(`\nCould not open the database: ${e.message}`);
  if (!ON_VERCEL) {
    if (process.env.DATABASE_URL) console.error('Check the Supabase connection string in .env (run `npm run connect-supabase` again), or delete .env to use the local database.\n');
    process.exit(1);
  }
});

// ---------- live updates (Server-Sent Events) ----------
const streams = new Set();
function broadcast(spaceIds) {
  const ids = [...spaceIds].filter(Boolean);
  if (!ids.length) return;
  const msg = `event: update\ndata: ${JSON.stringify({ spaces: ids, at: Date.now() })}\n\n`;
  for (const res of streams) res.write(msg);
}
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 25_000).unref();

// Every 15 seconds: release no-shows and long breaks, end finished bookings, run the demo activity.
// A normal server does this on a timer; on Vercel it happens on the next request once 15 seconds have passed.
let ticking = false, lastTick = Date.now();
async function tick() {
  if (ticking) return;        // a slow round never overlaps the next one
  ticking = true; lastTick = Date.now();
  try {
    const now = Date.now();
    const changed = await sweep(db, now);
    if ((await getSetting(db, 'demo_activity', '1')) === '1') for (const id of await simulate(db, now)) changed.add(id);
    broadcast(changed);
  } catch (e) { console.error('[tick]', e.message); }
  finally { ticking = false; }
}
if (!ON_VERCEL) setInterval(() => { if (!initError && db) tick(); }, 15_000).unref();

// The visitor's address (behind Vercel it comes from a header) and whether the page was loaded over https.
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
const isHttps = (req) => String(req.headers['x-forwarded-proto'] || '').includes('https');

// ---------- tiny router ----------
const routes = [];
const route = (method, path, handler, opts = {}) =>
  routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

// Who is logged in is remembered for a minute, so each page doesn't need an extra trip to the database.
const sessionCache = new Map();
const forgetSession = (token) => sessionCache.delete(token);
const forgetUserSessions = (userId) => { for (const [t, v] of sessionCache) if (v.user?.id === userId) sessionCache.delete(t); };
async function currentUser(req) {
  const token = parseCookies(req.headers.cookie).sts;
  if (!token) return null;
  const hit = sessionCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const user = await db.get(`SELECT u.id, u.reg_no, u.name, u.role, u.title FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token = ? AND s.expires_at > ?`, token, Date.now());
  sessionCache.set(token, { user, until: Date.now() + 60_000 });
  if (sessionCache.size > 5000) sessionCache.clear();
  return user;
}

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
// Only wrong passwords count towards a short lockout, separately for each login page and ID.
const failures = new Map();
function checkLockout(key) {
  const a = failures.get(key);
  if (a && a.until > Date.now() && a.n >= 8) throw new HttpError(429, `Too many wrong tries. Wait ${Math.ceil((a.until - Date.now()) / 1000)} seconds and try again.`);
}
function recordFailure(key) {
  const now = Date.now(), a = failures.get(key);
  if (!a || a.until < now) failures.set(key, { n: 1, until: now + 60_000 }); else a.n++;
}
function limitRegister(ip) { const key = `register:${ip}`; checkLockout(key); recordFailure(key); }
// A password copied with a stray space before or after it still works.
const passwordMatches = (pw, hash) => verifyPassword(pw, hash) || (pw.trim() !== pw && verifyPassword(pw.trim(), hash));
async function startSession(userId, req) {
  const token = newToken();
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, Date.now() + SESSION_DAYS * 86_400_000);
  return { 'Set-Cookie': `sts=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${isHttps(req) ? '; Secure' : ''}` };
}
const publicUser = (u) => u && (u.role === 'staff'
  ? { id: u.id, name: u.name, staff_id: u.reg_no, title: u.title, role: 'staff' }
  : { id: u.id, name: u.name, reg_no: u.reg_no, role: 'student' });

// Only these API routes work without logging in; everything else needs an account.
route('GET', '/api/meta', () => ({ now: Date.now(), rules: RULES, live: ON_VERCEL ? 'poll' : 'stream' }), { public: true });
route('GET', '/api/me', ({ user }) => ({ user: publicUser(user) }), { public: true });

route('POST', '/api/register', async ({ body, req }) => {
  limitRegister(clientIp(req));
  const name = String(body.name || '').trim();
  const reg = String(body.reg_no || '').trim();
  const pw = String(body.password || '');
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Enter your name.');
  if (!/^\d{5,12}$/.test(reg)) throw new HttpError(400, 'Registration number should be 5 to 12 digits.');
  if (pw.length < 6) throw new HttpError(400, 'Password needs at least 6 characters.');
  if (pw !== pw.trim()) throw new HttpError(400, "A password can't start or end with a space.");
  if (await db.get('SELECT 1 AS x FROM users WHERE reg_no = ?', reg)) throw new HttpError(409, 'That registration number already has an account. Log in instead.');
  const r = await db.run("INSERT INTO users (reg_no, name, pass_hash, role, created_at) VALUES (?, ?, ?, 'student', ?) RETURNING id, reg_no, name, role",
    reg, name, hashPassword(pw), Date.now());
  const row = r.rows[0];
  return { status: 201, body: { user: publicUser(row) }, headers: await startSession(row.id, req) };
}, { public: true });

route('POST', '/api/login', async ({ body, req }) => {
  const reg = String(body.reg_no || '').trim();
  const key = `student:${clientIp(req)}:${reg}`;
  checkLockout(key);
  const row = await db.get('SELECT * FROM users WHERE reg_no = ? AND is_demo = 0', reg);
  if (!row || !passwordMatches(String(body.password || ''), row.pass_hash)) {
    recordFailure(key);
    throw new HttpError(401, 'Registration number or password is wrong. Passwords are case-sensitive.');
  }
  if (row.role !== 'student') throw new HttpError(403, 'This is the student login. Library staff, please use the staff login page.');
  failures.delete(key);
  return { body: { user: publicUser(row) }, headers: await startSession(row.id, req) };
}, { public: true });

// Staff have their own login page and endpoint, which refuses student accounts.
route('POST', '/api/staff/login', async ({ body, req }) => {
  const id = String(body.staff_id || '').trim();
  const key = `staff:${clientIp(req)}:${id.toUpperCase()}`; // each Staff ID has its own lockout
  checkLockout(key);
  const row = (await db.get('SELECT * FROM users WHERE reg_no = ? AND is_demo = 0', id.toUpperCase()))
    || (await db.get('SELECT * FROM users WHERE reg_no = ? AND is_demo = 0', id));
  if (!row || !passwordMatches(String(body.password || ''), row.pass_hash)) {
    recordFailure(key);
    // the server log says why a login failed (never the password itself), so problems can be traced
    console.log(`[staff login] failed for "${id}": ${!row ? 'no account with this ID' : 'wrong password'} (password length ${String(body.password || '').length})`);
    if (!row && /^\d+$/.test(id)) throw new HttpError(401, 'That looks like a student registration number. Staff log in with a Staff ID such as LIB001.');
    if (!row) throw new HttpError(401, `There is no staff account with the ID "${id}". Staff IDs look like LIB001.`);
    if (row.role !== 'staff') throw new HttpError(401, 'Staff ID or password is wrong.');
    throw new HttpError(401, `That password is wrong for ${row.reg_no}. Passwords are case-sensitive: press Show to check what you typed.`);
  }
  if (row.role !== 'staff') throw new HttpError(403, 'This login is for library staff only. Students, please use the student login.');
  failures.delete(key);
  return { body: { user: publicUser(row) }, headers: await startSession(row.id, req) };
}, { public: true });

// Change your own password (students and staff). Logs out your other devices.
route('POST', '/api/password', async ({ body, req, user }) => {
  const key = `password:${user.id}`;
  checkLockout(key);
  const row = await db.get('SELECT pass_hash FROM users WHERE id = ?', user.id);
  const current = String(body.current || ''), next = String(body.next || '');
  if (!passwordMatches(current, row.pass_hash)) { recordFailure(key); throw new HttpError(400, 'Your current password is wrong.'); }
  if (next.length < 8) throw new HttpError(400, 'The new password needs at least 8 characters.');
  if (next !== next.trim()) throw new HttpError(400, "A password can't start or end with a space.");
  if (next === current) throw new HttpError(400, 'Pick a new password that is different from the current one.');
  await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(next), user.id);
  await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', user.id, parseCookies(req.headers.cookie).sts);
  const keep = sessionCache.get(parseCookies(req.headers.cookie).sts);
  forgetUserSessions(user.id);                       // other devices are logged out straight away
  if (keep) sessionCache.set(parseCookies(req.headers.cookie).sts, keep);
  failures.delete(key);
  return { ok: true };
}, { anyRole: true });

route('POST', '/api/logout', async ({ req }) => {
  const token = parseCookies(req.headers.cookie).sts;
  if (token) { await db.run('DELETE FROM sessions WHERE token = ?', token); forgetSession(token); }
  return { body: { ok: true }, headers: { 'Set-Cookie': 'sts=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' } };
}, { public: true });

// ---------- spaces ----------
function windowFrom(query, now) {
  let start = Number(query.start) || now;
  if (start < now) start = now;
  const dur = RULES.DURATIONS_MIN.includes(Number(query.dur)) ? Number(query.dur) : 60;
  return { from: start, to: start + dur * MIN, dur };
}
const allSpaces = () => db.all('SELECT * FROM spaces ORDER BY sort');

route('GET', '/api/spaces', async ({ query, user }) => {
  const now = Date.now();
  const win = windowFrom(query, now);
  const kinds = String(query.kinds || '').split(',').filter(Boolean);
  const q = String(query.q || '').trim().toLowerCase();
  let list = await allSpaces();
  if (kinds.length) list = list.filter((sp) => kinds.some((k) => sp.kinds.split(',').includes(k)));
  if (q) list = list.filter((sp) => `${sp.name} ${sp.area} ${sp.block}`.toLowerCase().includes(q));
  let spaces = await spaceSummaries(db, list, win.from, win.to, now, user.id);
  if (query.power === '1') spaces = spaces.filter((s) => s.power_free > 0);
  return { window: win, spaces };
});

async function oneSpace(id, from, to, now, userId) {
  const sp = await db.get('SELECT * FROM spaces WHERE id = ?', id);
  if (!sp) throw new HttpError(404, 'Study space not found.');
  const [[space], seats] = await Promise.all([spaceSummaries(db, [sp], from, to, now, userId), seatStates(db, sp.id, from, to, now, userId)]);
  return { space, seats };
}

route('GET', '/api/spaces/:id', async ({ params, query, user }) => {
  const now = Date.now();
  const win = windowFrom(query, now);
  return { window: win, ...(await oneSpace(params.id, win.from, win.to, now, user.id)) };
});

// ---------- bookings ----------
route('GET', '/api/bookings/mine', async ({ user }) => ({
  active: await bookingViews(db, `WHERE b.user_id = ? AND b.status IN ${ACTIVE_SQL} ORDER BY b.start_at`, user.id),
  past: await bookingViews(db, `WHERE b.user_id = ? AND b.status NOT IN ${ACTIVE_SQL} ORDER BY b.start_at DESC LIMIT 12`, user.id),
}));

route('POST', '/api/bookings', async ({ user, body }) => {
  const now = Date.now();
  const start = body.start === 'now' || !body.start ? now : Number(body.start);
  const id = await createBooking(db, { userId: user.id, seatId: Number(body.seat_id), start, durationMin: Number(body.duration), now });
  const view = await bookingView(db, id);
  broadcast([view.space.id]);
  return { status: 201, body: { booking: view } };
});

const act = (fn) => async ({ user, params, body }) => {
  const seatId = await fn(Number(params.id), user.id, body, Date.now());
  broadcast([await spaceOfSeat(db, seatId)]);
  return { booking: await bookingView(db, Number(params.id)) };
};
route('POST', '/api/bookings/:id/checkin', act((id, uid, body, now) => checkIn(db, id, uid, body.code, now)));
route('POST', '/api/bookings/:id/break', act((id, uid, body, now) => startBreak(db, id, uid, now)));
route('POST', '/api/bookings/:id/resume', act((id, uid) => endBreak(db, id, uid)));
route('POST', '/api/bookings/:id/checkout', act((id, uid, body, now) => checkOut(db, id, uid, now)));
route('POST', '/api/bookings/:id/cancel', act((id, uid, body, now) => cancel(db, id, uid, now)));

// For demos without a printed sticker: the owner of a reserved booking can reveal the desk code.
route('GET', '/api/bookings/:id/desk-code', async ({ user, params }) => {
  const b = await db.get('SELECT b.user_id, b.status, s.code, s.label FROM bookings b JOIN seats s ON s.id = b.seat_id WHERE b.id = ?', Number(params.id));
  if (!b || b.user_id !== user.id) throw new HttpError(404, 'Booking not found.');
  if (b.status !== 'reserved') throw new HttpError(409, 'Only needed before you check in.');
  return { code: b.code, seat: b.label };
});

// QR sticker link: /checkin?seat=ID&code=XXXX lands here after login.
route('POST', '/api/checkin', async ({ user, body }) => {
  const now = Date.now();
  const b = await db.get(`SELECT id FROM bookings WHERE user_id = ? AND seat_id = ? AND status = 'reserved'
                          AND start_at - ? <= ? AND start_at + ? > ? ORDER BY start_at LIMIT 1`,
    user.id, Number(body.seat_id), RULES.CHECKIN_EARLY_MIN * MIN, now, RULES.CHECKIN_GRACE_MIN * MIN, now);
  if (!b) throw new HttpError(404, 'You have no booking for this desk right now. Reserve it first, or check My Bookings.');
  const seatId = await checkIn(db, b.id, user.id, body.code, now);
  broadcast([await spaceOfSeat(db, seatId)]);
  return { booking: await bookingView(db, b.id) };
});

// ---------- reports ----------
const REASONS = {
  bag: 'Bag or belongings on the seat, nobody there',
  socket: 'Power socket not working',
  noise: 'Too noisy',
  other: 'Something else',
};
route('GET', '/api/reports/reasons', () => ({ reasons: REASONS }), { anyRole: true });

route('POST', '/api/reports', async ({ user, body }) => {
  const seat = await db.get('SELECT id FROM seats WHERE id = ?', Number(body.seat_id));
  if (!seat) throw new HttpError(400, 'Pick the seat you are reporting.');
  if (!REASONS[body.reason]) throw new HttpError(400, 'Pick what is wrong.');
  const note = String(body.note || '').trim().slice(0, 500);
  if (await db.get("SELECT 1 AS x FROM reports WHERE seat_id = ? AND user_id = ? AND status = 'open'", seat.id, user.id)) {
    throw new HttpError(409, 'You already reported this seat. Staff will check it soon.');
  }
  const r = await db.run('INSERT INTO reports (seat_id, user_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    seat.id, user.id, body.reason, note || null, Date.now());
  broadcast([await spaceOfSeat(db, seat.id), 'reports']);
  return { status: 201, body: { id: r.rows[0].id } };
});

const reportRows = async (where, ...args) => (await db.all(`SELECT r.*, s.label AS seat_label, s.power, s.power_ok, sp.id AS space_id, sp.name AS space_name, sp.area AS space_area,
    u.name AS user_name, h.name AS handler_name, h.title AS handler_title
  FROM reports r JOIN seats s ON s.id = r.seat_id JOIN spaces sp ON sp.id = s.space_id JOIN users u ON u.id = r.user_id
  LEFT JOIN users h ON h.id = r.resolved_by
  ${where} ORDER BY COALESCE(r.resolved_at, r.created_at) DESC LIMIT 60`, ...args)).map((r) => ({ ...r, reason_text: REASONS[r.reason] }));

// What is happening at a seat right now, so staff know what they will find there.
async function seatNow(seatId, now) {
  const b = await db.get(`SELECT b.status, b.start_at, b.end_at, b.break_started_at, u.name, u.is_demo FROM bookings b JOIN users u ON u.id = b.user_id
                          WHERE b.seat_id = ? AND b.status IN ${ACTIVE_SQL} AND b.start_at <= ? AND b.end_at > ? LIMIT 1`, seatId, now, now);
  if (!b) return { status: 'free' };
  return { status: b.status, student: b.name, is_demo: b.is_demo, until: b.end_at,
    back_by: b.break_started_at ? b.break_started_at + RULES.BREAK_MAX_MIN * MIN : null,
    checkin_by: b.status === 'reserved' ? b.start_at + RULES.CHECKIN_GRACE_MIN * MIN : null };
}

route('GET', '/api/reports/mine', async ({ user }) => ({ reports: await reportRows('WHERE r.user_id = ?', user.id) }));

// ---------- staff ----------
route('GET', '/api/staff/overview', async ({ user }) => {
  const now = Date.now();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const [spaces, active, open, recent, today, mine, broken, demo] = await Promise.all([
    allSpaces().then((list) => spaceSummaries(db, list, now, now + 1, now)),
    bookingViews(db, `WHERE b.status IN ${ACTIVE_SQL} AND b.start_at <= ? ORDER BY (b.status = 'on_break') DESC, b.start_at LIMIT 400`, now),
    reportRows("WHERE r.status = 'open'"),
    reportRows("WHERE r.status != 'open'"),
    db.get("SELECT COUNT(*) AS n FROM reports WHERE status = 'resolved' AND resolved_at >= ?", dayStart.getTime()),
    db.get("SELECT COUNT(*) AS n FROM reports WHERE status = 'resolved' AND resolved_by = ? AND resolved_at >= ?", user.id, dayStart.getTime()),
    db.all(`SELECT s.id, s.label, sp.name AS space_name, sp.area AS space_area FROM seats s JOIN spaces sp ON sp.id = s.space_id
            WHERE s.power = 1 AND s.power_ok = 0 ORDER BY sp.sort, s.id`),
    getSetting(db, 'demo_activity', '1'),
  ]);
  return {
    spaces, active,
    reports: await Promise.all(open.map(async (r) => ({ ...r, seat_now: await seatNow(r.seat_id, now) }))),
    recent_reports: recent.slice(0, 25),
    handled_today: today.n, handled_by_me_today: mine.n,
    broken_sockets: broken,
    demo_activity: demo === '1',
  };
});

route('POST', '/api/staff/reports/:id/resolve', async ({ user, params, body }) => {
  const r = await db.get('SELECT * FROM reports WHERE id = ?', Number(params.id));
  if (!r || r.status !== 'open') throw new HttpError(404, 'Report not found or already handled.');
  if (!['release', 'socket', 'dismiss'].includes(body.action)) throw new HttpError(400, 'Unknown action.');
  const now = Date.now();
  const note = String(body.note || '').trim().slice(0, 300) || null;
  const resolution = await db.tx(async (t) => {
    let text;
    if (body.action === 'release') {
      const n = await releaseSeatNow(t, r.seat_id, now, 'Released by library staff after a report');
      text = n ? 'Seat released by staff' : 'Seat was already free';
    } else if (body.action === 'socket') {
      await t.run('UPDATE seats SET power_ok = 0 WHERE id = ?', r.seat_id);
      text = 'Socket marked as not working';
    } else {
      text = 'Checked: no problem found';
    }
    await t.run("UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ?, staff_note = ? WHERE id = ?", text, now, user.id, note, r.id);
    return text;
  });
  broadcast([await spaceOfSeat(db, r.seat_id), 'reports']);
  return { ok: true, resolution };
});

route('POST', '/api/staff/seats/:id/release', async ({ params }) => {
  const n = await releaseSeatNow(db, Number(params.id), Date.now(), 'Released by library staff');
  broadcast([await spaceOfSeat(db, Number(params.id))]);
  return { released: n };
});

route('POST', '/api/staff/seats/:id/power', async ({ params, body }) => {
  await db.run('UPDATE seats SET power_ok = ? WHERE id = ? AND power = 1', body.ok ? 1 : 0, Number(params.id));
  broadcast([await spaceOfSeat(db, Number(params.id))]);
  return { ok: true };
});

route('POST', '/api/staff/settings', async ({ body }) => {
  if ('demo_activity' in body) await setSetting(db, 'demo_activity', body.demo_activity ? '1' : '0');
  return { demo_activity: (await getSetting(db, 'demo_activity', '1')) === '1' };
});

route('GET', '/api/staff/spaces/:id', async ({ params }) => {
  const now = Date.now();
  return oneSpace(params.id, now, now + 1, now, 0);
});

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

route('GET', '/api/staff/desk-codes', async ({ query, req }) => {
  const sp = await db.get('SELECT id, name, area FROM spaces WHERE id = ?', String(query.space || ''));
  if (!sp) throw new HttpError(404, 'Pick a study space.');
  return {
    space: sp,
    base_url: process.env.PUBLIC_URL || (ON_VERCEL ? `https://${req.headers['x-forwarded-host'] || req.headers.host}` : `http://${lanAddress()}:${PORT}`),
    seats: await db.all('SELECT id, label, code FROM seats WHERE space_id = ? ORDER BY id', sp.id),
  };
});

// ---------- Supabase setup page (only from this computer, only until it is set up) ----------
const ENV_FILE = join(ROOT, '.env');
const TEMPLATE_FILE = join(ROOT, 'supabase-password.txt');
const fromThisComputer = (req) => !ON_VERCEL && !req.headers['x-forwarded-for'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function savedDatabaseUrl() {
  if (!existsSync(ENV_FILE)) return null;
  const line = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('DATABASE_URL='));
  return line ? line.trim().slice(13).replace(/^"|"$/g, '') : null;
}
const PLACEHOLDER = /\[YOUR[-_ A-Z]*PASSWORD\]|PASTE-PASSWORD-HERE/i;

route('GET', '/api/setup/supabase', ({ req }) => {
  if (ON_VERCEL) throw new HttpError(403, 'On Vercel, the Supabase connection is set in your Vercel project: Settings > Environment Variables > DATABASE_URL.');
  if (!fromThisComputer(req)) throw new HttpError(403, 'This page only works on the computer running the app.');
  const saved = savedDatabaseUrl();
  let template = '';
  if (existsSync(TEMPLATE_FILE)) {
    const l = readFileSync(TEMPLATE_FILE, 'utf8').split(/\r?\n/).find((x) => x.trim().startsWith('DATABASE_URL='));
    if (l) template = l.trim().slice(13).replace(/^(postgres(?:ql)?:\/\/[^:/@]+):.*@([^@]+)$/, '$1:[YOUR-DATABASE-PASSWORD]@$2'); // never send a password back
  }
  let host = null; try { host = saved && new URL(saved).hostname; } catch { /* unreadable */ }
  return { configured: !!saved, host, in_use: db.dialect === 'pg', using: db.where, template };
}, { public: true });

route('POST', '/api/setup/supabase', async ({ req, body }) => {
  if (!fromThisComputer(req)) throw new HttpError(403, 'This page only works on the computer running the app.');
  if (savedDatabaseUrl()) throw new HttpError(409, 'Supabase is already set up. To change it, delete the .env file first.');
  let url = String(body.url || '').trim();
  const pw = String(body.password || '');
  if (!/^postgres(ql)?:\/\//.test(url)) throw new HttpError(400, 'Paste the Session pooler connection string. It starts with postgresql://');
  if (PLACEHOLDER.test(url)) {
    if (!pw) throw new HttpError(400, 'Paste your database password.');
    url = url.replace(PLACEHOLDER, () => encodeURIComponent(pw));
  }
  const m = url.match(/^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@]+)$/); // passwords with @ # / ? need encoding
  if (m) { let p2 = m[3]; try { p2 = decodeURIComponent(p2); } catch { /* plain */ } url = `${m[1]}${m[2]}:${encodeURIComponent(p2)}@${m[4]}`; }
  let host;
  try { host = new URL(url).hostname; } catch { throw new HttpError(400, "That doesn't look like a connection string."); }
  try {
    const test = await openStore({ url });
    const v = await test.get('SELECT version() AS v');
    await test.close();
    writeFileSync(ENV_FILE, `DATABASE_URL="${url}"\n`);
    chmodSync(ENV_FILE, 0o600);
    if (existsSync(TEMPLATE_FILE)) rmSync(TEMPLATE_FILE);
    console.log(`[setup] Supabase connection saved to .env (${host}). Restart the app to use it.`);
    return { ok: true, host, version: String(v.v).split(',')[0] };
  } catch (e) {
    const msg = String(e.message || e);
    console.log(`[setup] Supabase connection test failed for ${host}: ${msg}`);
    if (/password authentication/i.test(msg)) throw new HttpError(400, 'Supabase says the password is wrong. Check it, or reset it in Supabase: Project Settings > Database > Reset database password.');
    if (/Tenant or user not found/i.test(msg)) throw new HttpError(400, 'Supabase does not recognise this project. Copy the Session pooler string again.');
    if (/ENOTFOUND|getaddrinfo/i.test(msg)) throw new HttpError(400, 'That address was not found. Use the "Session pooler" connection string, not "Direct connection".');
    throw new HttpError(400, `Could not connect: ${msg}`);
  }
}, { public: true });

// ---------- insights ----------
let insightsCache = null;
async function busyTimes() {
  const day = new Date().toDateString();
  if (insightsCache && insightsCache.day === day) return insightsCache.data;   // history only changes once a day
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 14);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const seatCount = new Map((await db.all('SELECT space_id, COUNT(*) AS n FROM seats GROUP BY space_id')).map((r) => [r.space_id, r.n]));
  const days = Math.round((today - since) / 86_400_000);
  const hours = Array.from({ length: 15 }, (_, i) => i + 8); // 8 am to 10 pm
  const tally = new Map();
  const rows = await db.all(`SELECT s.space_id, b.checked_in_at, COALESCE(b.ended_at, b.end_at) AS left_at FROM bookings b JOIN seats s ON s.id = b.seat_id
                             WHERE b.checked_in_at IS NOT NULL AND b.start_at >= ? AND b.start_at < ?`, since.getTime(), today.getTime());
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
  insightsCache = { day, data: { days, hours: data } };
  return insightsCache.data;
}

route('GET', '/api/insights', async () => {
  const now = Date.now();
  const [busy, list] = await Promise.all([busyTimes(), allSpaces()]);
  const summaries = await spaceSummaries(db, list, now, now + 1, now);
  return {
    based_on_days: busy.days,
    spaces: summaries.map((s) => {
      const hourly = busy.hours[s.id] || [];
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

// Handles one request. Vercel calls this from api/index.js; `npm start` wraps it in a normal server below.
export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  await ready;
  if (initError) return sendJson(res, 503, { error: `The server could not open the database: ${initError.message}` });
  if (ON_VERCEL && Date.now() - lastTick > 15_000) await tick();

  try {
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      if (ON_VERCEL) { res.writeHead(204); return res.end(); } // pages refresh themselves on Vercel instead
      if (!(await currentUser(req))) return sendJson(res, 401, { error: 'Please log in first.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Not found.');
    const params = url.pathname.match(r.re).groups || {};
    const user = await currentUser(req);
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
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on the server.' });
  }
}

if (!ON_VERCEL) http.createServer(handle).listen(PORT, '0.0.0.0', async () => {
  await ready;
  console.log(`\nA Seat to Study is running`);
  console.log(`  database:          ${db.where}`);
  console.log(`  on this computer:  http://localhost:${PORT}`);
  console.log(`  on your Wi-Fi:     http://${lanAddress()}:${PORT}  (open on a phone to scan desk QR codes)`);
  console.log(`  student login: /login · staff login: /staff/login (demo accounts are in README.md: student ${DEMO_ACCOUNTS.student.reg_no}, staff ${STAFF_ACCOUNTS.map((s) => s.staff_id).join(', ')})\n`);
});
