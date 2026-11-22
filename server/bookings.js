// Seat availability and the booking life cycle:
// reserved -> checked_in <-> on_break -> completed, with automatic release for no-shows and long breaks.
import { RULES, MIN } from './config.js';

export const ACTIVE_SQL = `('reserved','checked_in','on_break')`;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Seats never move between spaces, so this lookup is cached.
const seatSpace = new Map();
export async function spaceOfSeat(db, seatId) {
  if (!seatSpace.has(seatId)) {
    const r = await db.get('SELECT space_id FROM seats WHERE id = ?', seatId);
    if (r) seatSpace.set(seatId, r.space_id);
  }
  return seatSpace.get(seatId);
}
async function spacesOfSeats(db, ids) {
  const out = new Set();
  for (const id of new Set(ids)) out.add(await spaceOfSeat(db, id));
  return out;
}

export async function seatIsFree(db, seatId, from, to, ignoreBookingId = 0) {
  return !(await db.get(`SELECT 1 AS x FROM bookings WHERE seat_id = ? AND id != ? AND status IN ${ACTIVE_SQL}
                         AND start_at < ? AND end_at > ? LIMIT 1`, seatId, ignoreBookingId, to, from));
}

// Work out each seat's status from the seats and the active bookings that overlap the window.
function statesFrom(seats, bookings, now, userId) {
  const bySeat = new Map();
  for (const b of bookings) { if (!bySeat.has(b.seat_id)) bySeat.set(b.seat_id, []); bySeat.get(b.seat_id).push(b); }
  return seats.map((s) => {
    const list = bySeat.get(s.id) || [];
    const mine = list.find((b) => b.user_id === userId);
    const inUse = list.find((b) => b.status === 'checked_in' && b.start_at <= now);
    const away = list.find((b) => b.status === 'on_break');
    const held = list[0];
    let status = 'available', info = null;
    if (mine) { status = 'mine'; info = { booking_id: mine.id, from: mine.start_at, until: mine.end_at }; }
    else if (inUse) { status = 'occupied'; info = { until: inUse.end_at }; }
    else if (away) { status = 'break'; info = { back_by: away.break_started_at + RULES.BREAK_MAX_MIN * MIN, until: away.end_at }; }
    else if (held) { status = 'reserved'; info = { from: held.start_at, until: held.end_at }; }
    const { space_id, ...seat } = s;
    return { ...seat, status, info };
  });
}

const SEAT_COLS = 'id, space_id, label, grp, pos, power, power_ok, capacity';
const BOOKING_COLS = 'b.id, b.seat_id, b.user_id, b.status, b.start_at, b.end_at, b.break_started_at';

// Status of every seat in one space for the window [from, to).
export async function seatStates(db, spaceId, from, to, now, userId = 0) {
  const [seats, bookings] = await Promise.all([
    db.all(`SELECT ${SEAT_COLS} FROM seats WHERE space_id = ? ORDER BY id`, spaceId),
    db.all(`SELECT ${BOOKING_COLS} FROM bookings b JOIN seats s ON s.id = b.seat_id
            WHERE s.space_id = ? AND b.status IN ${ACTIVE_SQL} AND b.start_at < ? AND b.end_at > ? ORDER BY b.start_at`, spaceId, to, from),
  ]);
  return statesFrom(seats, bookings, now, userId);
}

// Live numbers for several spaces at once (three queries in total, however many spaces).
export async function spaceSummaries(db, spaces, from, to, now, userId = 0) {
  if (!spaces.length) return [];
  const [seats, bookings, live] = await Promise.all([
    db.all(`SELECT ${SEAT_COLS} FROM seats ORDER BY id`),
    db.all(`SELECT ${BOOKING_COLS} FROM bookings b WHERE b.status IN ${ACTIVE_SQL} AND b.start_at < ? AND b.end_at > ? ORDER BY b.start_at`, to, from),
    db.all(`SELECT s.space_id, COUNT(DISTINCT b.seat_id) AS n FROM bookings b JOIN seats s ON s.id = b.seat_id
            WHERE b.status IN ${ACTIVE_SQL} AND b.start_at <= ? AND b.end_at > ? GROUP BY s.space_id`, now, now),
  ]);
  const liveBy = new Map(live.map((r) => [r.space_id, r.n]));
  return spaces.map((space) => {
    const mineSeats = seats.filter((s) => s.space_id === space.id);
    const ids = new Set(mineSeats.map((s) => s.id));
    const states = statesFrom(mineSeats, bookings.filter((b) => ids.has(b.seat_id)), now, userId);
    const free = states.filter((s) => s.status === 'available');
    const total = states.length;
    return {
      id: space.id, name: space.name, area: space.area, block: space.block, kinds: space.kinds.split(','),
      layout: space.layout, blurb: space.blurb, unit: space.layout === 'rooms' ? 'room' : 'seat', cols: space.cols,
      total, free: free.length, in_use_now: liveBy.get(space.id) || 0,
      power_total: states.filter((s) => s.power && s.power_ok).length,
      power_free: free.filter((s) => s.power && s.power_ok).length,
      status: free.length === 0 ? 'Full' : free.length / total > 0.25 ? 'Available' : 'Filling up',
    };
  });
}

const VIEW_SQL = `SELECT b.*, s.label AS seat_label, s.space_id, s.power, s.power_ok, s.capacity,
                         sp.name AS space_name, sp.area AS space_area, sp.layout, u.name AS user_name, u.is_demo AS user_is_demo
                  FROM bookings b JOIN seats s ON s.id = b.seat_id JOIN spaces sp ON sp.id = s.space_id JOIN users u ON u.id = b.user_id`;
function toView(b) {
  return {
    id: b.id, status: b.status, start_at: b.start_at, end_at: b.end_at,
    checked_in_at: b.checked_in_at, break_started_at: b.break_started_at, breaks_used: b.breaks_used,
    ended_at: b.ended_at, end_reason: b.end_reason, created_at: b.created_at,
    checkin_opens_at: b.start_at - RULES.CHECKIN_EARLY_MIN * MIN,
    checkin_deadline: b.start_at + RULES.CHECKIN_GRACE_MIN * MIN,
    break_deadline: b.break_started_at ? b.break_started_at + RULES.BREAK_MAX_MIN * MIN : null,
    seat: { id: b.seat_id, label: b.seat_label, power: b.power, power_ok: b.power_ok, capacity: b.capacity },
    space: { id: b.space_id, name: b.space_name, area: b.space_area, layout: b.layout },
    user_id: b.user_id, user_name: b.user_name, is_demo: b.user_is_demo,
  };
}
export async function bookingViews(db, where, ...params) {
  return (await db.all(`${VIEW_SQL} ${where}`, ...params)).map(toView);
}
export async function bookingView(db, id) {
  return (await bookingViews(db, 'WHERE b.id = ?', id))[0] || null;
}

// Reserve a seat. Runs in a transaction that locks the seat, so two people can't take it at the same moment.
export async function createBooking(db, { userId, seatId, start, durationMin, now, isDemo = 0, plan = null, status = 'reserved', endAt = null, checkedInAt = null }) {
  if (!RULES.DURATIONS_MIN.includes(durationMin)) throw new HttpError(400, 'Pick a length between 1 and 3 hours.');
  if (start < now - MIN) throw new HttpError(400, 'That time has already passed.');
  if (start > now + RULES.BOOK_AHEAD_HOURS * 60 * MIN) throw new HttpError(400, `You can book up to ${RULES.BOOK_AHEAD_HOURS} hours ahead.`);
  const end = endAt || start + durationMin * MIN;
  return db.tx(async (t) => {
    const seat = await t.get(`SELECT id FROM seats WHERE id = ?${db.dialect === 'pg' ? ' FOR UPDATE' : ''}`, seatId);
    if (!seat) throw new HttpError(404, 'That seat does not exist.');
    if (!(await seatIsFree(t, seatId, start, end))) throw new HttpError(409, 'Someone else has this seat at that time. Pick another seat or time.');
    if (!isDemo) {
      const mine = await t.all(`SELECT start_at, end_at FROM bookings WHERE user_id = ? AND status IN ${ACTIVE_SQL}`, userId);
      if (mine.some((b) => b.start_at < end && b.end_at > start)) throw new HttpError(409, 'You already have a seat booked at that time. Cancel it first in My Bookings.');
      if (mine.length >= RULES.MAX_ACTIVE_BOOKINGS) throw new HttpError(409, `You can hold at most ${RULES.MAX_ACTIVE_BOOKINGS} bookings at once.`);
    }
    const r = await t.run(`INSERT INTO bookings (user_id, seat_id, start_at, end_at, status, checked_in_at, is_demo, plan, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      userId, seatId, start, end, status, status === 'checked_in' ? (checkedInAt || now) : null, isDemo ? 1 : 0, plan, now);
    return r.rows[0].id;
  });
}

async function own(db, bookingId, userId) {
  const b = await db.get('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!b || b.user_id !== userId) throw new HttpError(404, 'Booking not found.');
  return b;
}

export async function checkIn(db, bookingId, userId, code, now) {
  const b = await own(db, bookingId, userId);
  if (b.status !== 'reserved') throw new HttpError(409, 'This booking is not waiting for check-in.');
  if (now < b.start_at - RULES.CHECKIN_EARLY_MIN * MIN) throw new HttpError(409, `Check-in opens ${RULES.CHECKIN_EARLY_MIN} minutes before your start time.`);
  const seat = await db.get('SELECT code FROM seats WHERE id = ?', b.seat_id);
  if (String(code || '').trim().toUpperCase() !== seat.code) throw new HttpError(400, 'That desk code does not match this seat. Check the sticker on your desk.');
  if (now < b.start_at && !(await seatIsFree(db, b.seat_id, now, b.start_at, b.id))) throw new HttpError(409, 'The seat is still in use until your slot starts.');
  await db.run("UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE id = ? AND status = 'reserved'", now, b.id);
  return b.seat_id;
}

export async function startBreak(db, bookingId, userId, now) {
  const b = await own(db, bookingId, userId);
  if (b.status !== 'checked_in') throw new HttpError(409, 'You can take a break once you are checked in.');
  if (b.end_at - now < 5 * MIN) throw new HttpError(409, 'Your time is almost up, so a break is not needed. Check out instead.');
  await db.run("UPDATE bookings SET status = 'on_break', break_started_at = ?, breaks_used = breaks_used + 1 WHERE id = ?", now, b.id);
  return b.seat_id;
}

export async function endBreak(db, bookingId, userId) {
  const b = await own(db, bookingId, userId);
  if (b.status !== 'on_break') throw new HttpError(409, 'You are not on a break.');
  await db.run("UPDATE bookings SET status = 'checked_in', break_started_at = NULL WHERE id = ?", b.id);
  return b.seat_id;
}

export async function checkOut(db, bookingId, userId, now) {
  const b = await own(db, bookingId, userId);
  if (b.status !== 'checked_in' && b.status !== 'on_break') throw new HttpError(409, 'You are not checked in.');
  await db.run("UPDATE bookings SET status = 'completed', ended_at = ?, end_reason = 'Checked out', break_started_at = NULL WHERE id = ?", now, b.id);
  return b.seat_id;
}

export async function cancel(db, bookingId, userId, now) {
  const b = await own(db, bookingId, userId);
  if (b.status !== 'reserved') throw new HttpError(409, 'Only bookings you have not checked in to can be cancelled.');
  await db.run("UPDATE bookings SET status = 'cancelled', ended_at = ?, end_reason = 'Cancelled' WHERE id = ?", now, b.id);
  return b.seat_id;
}

export async function releaseSeatNow(db, seatId, now, reason) {
  const r = await db.run(`UPDATE bookings SET status = 'released', ended_at = ?, end_reason = ?, break_started_at = NULL
                          WHERE seat_id = ? AND status IN ${ACTIVE_SQL} AND start_at <= ? RETURNING id`, now, reason, seatId, now);
  return r.changes;
}

// Ends bookings whose time is up, releases no-shows and breaks that ran too long.
export async function sweep(db, now) {
  const a = await db.run(`UPDATE bookings SET status = 'no_show', ended_at = ?, end_reason = ?
                          WHERE status = 'reserved' AND start_at + ? <= ? RETURNING seat_id`,
    now, `Released: not checked in within ${RULES.CHECKIN_GRACE_MIN} minutes`, RULES.CHECKIN_GRACE_MIN * MIN, now);
  const b = await db.run(`UPDATE bookings SET status = 'released', ended_at = ?, end_reason = ?, break_started_at = NULL
                          WHERE status = 'on_break' AND break_started_at + ? <= ? RETURNING seat_id`,
    now, `Released: break ran over ${RULES.BREAK_MAX_MIN} minutes`, RULES.BREAK_MAX_MIN * MIN, now);
  const c = await db.run(`UPDATE bookings SET status = 'completed', ended_at = end_at, end_reason = 'Time ended', break_started_at = NULL
                          WHERE status IN ('checked_in','on_break') AND end_at <= ? RETURNING seat_id`, now);
  return spacesOfSeats(db, [...a.rows, ...b.rows, ...c.rows].map((r) => r.seat_id));
}
