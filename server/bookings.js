// Seat availability and the booking life cycle:
// reserved -> checked_in <-> on_break -> completed, with automatic release for no-shows and long breaks.
import { RULES, MIN } from './config.js';

export const ACTIVE = ['reserved', 'checked_in', 'on_break'];
const ACTIVE_SQL = `('reserved','checked_in','on_break')`;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function spaceOfSeat(db, seatId) {
  return db.q('SELECT space_id FROM seats WHERE id = ?').get(seatId)?.space_id;
}

// Active bookings that overlap [from, to) for every seat in a space.
function activeInSpace(db, spaceId, from, to) {
  return db.q(`SELECT b.id, b.seat_id, b.user_id, b.status, b.start_at, b.end_at, b.break_started_at
               FROM bookings b JOIN seats s ON s.id = b.seat_id
               WHERE s.space_id = ? AND b.status IN ${ACTIVE_SQL} AND b.start_at < ? AND b.end_at > ?
               ORDER BY b.start_at`).all(spaceId, to, from);
}

export function seatIsFree(db, seatId, from, to, ignoreBookingId = 0) {
  return !db.q(`SELECT 1 FROM bookings WHERE seat_id = ? AND id != ? AND status IN ${ACTIVE_SQL}
                AND start_at < ? AND end_at > ? LIMIT 1`).get(seatId, ignoreBookingId, to, from);
}

// Status of every seat in a space for the time window [from, to).
export function seatStates(db, spaceId, from, to, now, userId = 0) {
  const seats = db.q('SELECT id, label, grp, pos, power, power_ok, capacity FROM seats WHERE space_id = ? ORDER BY id').all(spaceId);
  const bySeat = new Map();
  for (const b of activeInSpace(db, spaceId, from, to)) {
    if (!bySeat.has(b.seat_id)) bySeat.set(b.seat_id, []);
    bySeat.get(b.seat_id).push(b);
  }
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
    return { ...s, status, info };
  });
}

// Live numbers for a space: in use right now, and free for the chosen window.
export function spaceSummary(db, space, from, to, now, userId = 0) {
  const seats = seatStates(db, space.id, from, to, now, userId);
  const live = db.q(`SELECT COUNT(DISTINCT b.seat_id) AS n FROM bookings b JOIN seats s ON s.id = b.seat_id
                     WHERE s.space_id = ? AND b.status IN ${ACTIVE_SQL} AND b.start_at <= ? AND b.end_at > ?`).get(space.id, now, now).n;
  const free = seats.filter((s) => s.status === 'available');
  const total = seats.length;
  const label = free.length === 0 ? 'Full' : free.length / total > 0.25 ? 'Available' : 'Filling up';
  return {
    id: space.id, name: space.name, area: space.area, block: space.block, kinds: space.kinds.split(','),
    layout: space.layout, blurb: space.blurb, unit: space.layout === 'rooms' ? 'room' : 'seat',
    total, free: free.length, in_use_now: live,
    power_total: seats.filter((s) => s.power && s.power_ok).length,
    power_free: free.filter((s) => s.power && s.power_ok).length,
    status: label,
  };
}

export function bookingView(db, id) {
  const b = db.q(`SELECT b.*, s.label AS seat_label, s.space_id, s.power, s.power_ok, s.capacity,
                         sp.name AS space_name, sp.area AS space_area, sp.layout
                  FROM bookings b JOIN seats s ON s.id = b.seat_id JOIN spaces sp ON sp.id = s.space_id
                  WHERE b.id = ?`).get(id);
  if (!b) return null;
  return {
    id: b.id, status: b.status, start_at: b.start_at, end_at: b.end_at,
    checked_in_at: b.checked_in_at, break_started_at: b.break_started_at, breaks_used: b.breaks_used,
    ended_at: b.ended_at, end_reason: b.end_reason, created_at: b.created_at,
    checkin_opens_at: b.start_at - RULES.CHECKIN_EARLY_MIN * MIN,
    checkin_deadline: b.start_at + RULES.CHECKIN_GRACE_MIN * MIN,
    break_deadline: b.break_started_at ? b.break_started_at + RULES.BREAK_MAX_MIN * MIN : null,
    seat: { id: b.seat_id, label: b.seat_label, power: b.power, power_ok: b.power_ok, capacity: b.capacity },
    space: { id: b.space_id, name: b.space_name, area: b.space_area, layout: b.layout },
    user_id: b.user_id,
  };
}

export function createBooking(db, { userId, seatId, start, durationMin, now, isDemo = 0, plan = null, status = 'reserved' }) {
  const seat = db.q('SELECT id, space_id FROM seats WHERE id = ?').get(seatId);
  if (!seat) throw new HttpError(404, 'That seat does not exist.');
  if (!RULES.DURATIONS_MIN.includes(durationMin)) throw new HttpError(400, 'Pick a length between 1 and 3 hours.');
  if (start < now - MIN) throw new HttpError(400, 'That time has already passed.');
  if (start > now + RULES.BOOK_AHEAD_HOURS * 60 * MIN) throw new HttpError(400, `You can book up to ${RULES.BOOK_AHEAD_HOURS} hours ahead.`);
  const end = start + durationMin * MIN;
  if (!seatIsFree(db, seatId, start, end)) throw new HttpError(409, 'Someone else has this seat at that time. Pick another seat or time.');
  if (!isDemo) {
    const mine = db.q(`SELECT start_at, end_at FROM bookings WHERE user_id = ? AND status IN ${ACTIVE_SQL}`).all(userId);
    if (mine.some((b) => b.start_at < end && b.end_at > start)) throw new HttpError(409, 'You already have a seat booked at that time. Cancel it first in My Bookings.');
    if (mine.length >= RULES.MAX_ACTIVE_BOOKINGS) throw new HttpError(409, `You can hold at most ${RULES.MAX_ACTIVE_BOOKINGS} bookings at once.`);
  }
  const r = db.q(`INSERT INTO bookings (user_id, seat_id, start_at, end_at, status, checked_in_at, is_demo, plan, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, seatId, start, end, status, status === 'checked_in' ? now : null, isDemo ? 1 : 0, plan, now);
  return Number(r.lastInsertRowid);
}

function own(db, bookingId, userId) {
  const b = db.q('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b || b.user_id !== userId) throw new HttpError(404, 'Booking not found.');
  return b;
}

export function checkIn(db, bookingId, userId, code, now) {
  const b = own(db, bookingId, userId);
  if (b.status !== 'reserved') throw new HttpError(409, 'This booking is not waiting for check-in.');
  if (now < b.start_at - RULES.CHECKIN_EARLY_MIN * MIN) throw new HttpError(409, `Check-in opens ${RULES.CHECKIN_EARLY_MIN} minutes before your start time.`);
  const seat = db.q('SELECT code FROM seats WHERE id = ?').get(b.seat_id);
  if (String(code || '').trim().toUpperCase() !== seat.code) throw new HttpError(400, 'That desk code does not match this seat. Check the sticker on your desk.');
  if (now < b.start_at && !seatIsFree(db, b.seat_id, now, b.start_at, b.id)) throw new HttpError(409, 'The seat is still in use until your slot starts.');
  db.q("UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE id = ?").run(now, b.id);
  return b.seat_id;
}

export function startBreak(db, bookingId, userId, now) {
  const b = own(db, bookingId, userId);
  if (b.status !== 'checked_in') throw new HttpError(409, 'You can take a break once you are checked in.');
  if (b.end_at - now < 5 * MIN) throw new HttpError(409, 'Your time is almost up, so a break is not needed. Check out instead.');
  db.q("UPDATE bookings SET status = 'on_break', break_started_at = ?, breaks_used = breaks_used + 1 WHERE id = ?").run(now, b.id);
  return b.seat_id;
}

export function endBreak(db, bookingId, userId) {
  const b = own(db, bookingId, userId);
  if (b.status !== 'on_break') throw new HttpError(409, 'You are not on a break.');
  db.q("UPDATE bookings SET status = 'checked_in', break_started_at = NULL WHERE id = ?").run(b.id);
  return b.seat_id;
}

export function checkOut(db, bookingId, userId, now) {
  const b = own(db, bookingId, userId);
  if (b.status !== 'checked_in' && b.status !== 'on_break') throw new HttpError(409, 'You are not checked in.');
  db.q("UPDATE bookings SET status = 'completed', ended_at = ?, end_reason = 'Checked out', break_started_at = NULL WHERE id = ?").run(now, b.id);
  return b.seat_id;
}

export function cancel(db, bookingId, userId, now) {
  const b = own(db, bookingId, userId);
  if (b.status !== 'reserved') throw new HttpError(409, 'Only bookings you have not checked in to can be cancelled.');
  db.q("UPDATE bookings SET status = 'cancelled', ended_at = ?, end_reason = 'Cancelled' WHERE id = ?").run(now, b.id);
  return b.seat_id;
}

export function releaseSeatNow(db, seatId, now, reason) {
  return db.q(`UPDATE bookings SET status = 'released', ended_at = ?, end_reason = ?, break_started_at = NULL
               WHERE seat_id = ? AND status IN ${ACTIVE_SQL} AND start_at <= ? RETURNING id`).all(now, reason, seatId, now).length;
}

// Ends bookings whose time is up, releases no-shows and breaks that ran too long.
export function sweep(db, now) {
  const seatIds = [
    ...db.q(`UPDATE bookings SET status = 'no_show', ended_at = ?, end_reason = ?
             WHERE status = 'reserved' AND start_at + ? <= ? RETURNING seat_id`)
      .all(now, `Released: not checked in within ${RULES.CHECKIN_GRACE_MIN} minutes`, RULES.CHECKIN_GRACE_MIN * MIN, now),
    ...db.q(`UPDATE bookings SET status = 'released', ended_at = ?, end_reason = ?, break_started_at = NULL
             WHERE status = 'on_break' AND break_started_at + ? <= ? RETURNING seat_id`)
      .all(now, `Released: break ran over ${RULES.BREAK_MAX_MIN} minutes`, RULES.BREAK_MAX_MIN * MIN, now),
    ...db.q(`UPDATE bookings SET status = 'completed', ended_at = end_at, end_reason = 'Time ended', break_started_at = NULL
             WHERE status IN ('checked_in','on_break') AND end_at <= ? RETURNING seat_id`).all(now),
  ].map((r) => r.seat_id);
  return new Set(seatIds.map((id) => spaceOfSeat(db, id)));
}
