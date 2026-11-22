// Demo activity: simulated students reserve, check in, take breaks and leave,
// so the prototype feels like a real evening in the library. Real accounts are never touched.
import { MIN, targetShare } from './config.js';
import { createBooking, seatIsFree, ACTIVE_SQL } from './bookings.js';
import { insertMany } from './db.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

let demoUsers = null;

// On start-up the empty library is filled in one bulk insert (much faster over the network to Supabase).
function startupRow(seatId, now) {
  const settled = Math.random() < 0.9;
  const start = settled ? now - between(1, 22) * 5 * MIN : now + between(0, 9) * 5 * MIN;
  let end = start + pick([60, 90, 120, 150, 180]) * MIN;
  if (end <= now + 10 * MIN) end = now + between(2, 8) * 10 * MIN;
  const plan = Math.random() < 0.05 ? 'overrun' : !settled && Math.random() < 0.12 ? 'noshow' : null;
  return [pick(demoUsers), seatId, start, end, settled ? 'checked_in' : 'reserved', settled ? start + between(0, 8) * MIN : null, 1, plan, now];
}

async function newDemoBooking(db, seatId, now, { settled = false } = {}) {
  const duration = pick([60, 90, 120, 150, 180]);
  let start = now, status = 'reserved', plan = null;
  const roll = Math.random();
  if (settled || roll < 0.2) {
    status = 'checked_in';                                   // already sitting there
    if (settled) start = now - between(1, 22) * 5 * MIN;     // on first start-up they've been there a while
  } else if (roll < 0.4) {
    start = now + between(3, 9) * 5 * MIN;                   // booked for later
  }
  if (status === 'reserved' && Math.random() < 0.12) plan = 'noshow';
  if (Math.random() < 0.05) plan = 'overrun';
  let end = start + duration * MIN;
  if (end <= now + 10 * MIN) end = now + between(2, 8) * 10 * MIN;
  if (!(await seatIsFree(db, seatId, start, end))) return false;
  try {
    await createBooking(db, {
      userId: pick(demoUsers), seatId, start, durationMin: duration, now: start, isDemo: 1, plan, status,
      endAt: end, checkedInAt: status === 'checked_in' ? start + between(0, 8) * MIN : null,
    });
    return true;
  } catch { return false; } // someone took the seat in the meantime
}

export async function simulate(db, now, { initial = false } = {}) {
  const changed = new Set();
  const startupRows = [];
  demoUsers ??= (await db.all('SELECT id FROM users WHERE is_demo = 1')).map((r) => r.id);
  const hour = new Date(now).getHours();
  const [spaces, seats, active] = await Promise.all([
    db.all('SELECT id, base FROM spaces'),
    db.all('SELECT id, space_id FROM seats'),
    db.all(`SELECT b.*, s.space_id FROM bookings b JOIN seats s ON s.id = b.seat_id WHERE b.status IN ${ACTIVE_SQL} AND b.end_at > ?`, now),
  ]);
  for (const sp of spaces) {
    const ids = seats.filter((s) => s.space_id === sp.id).map((s) => s.id);
    const here = active.filter((b) => b.space_id === sp.id);
    const inUse = here.filter((b) => b.start_at <= now).length;
    const target = Math.round(ids.length * targetShare(sp.base, hour));

    if (!initial) {
      for (const b of here) {
        if (!b.is_demo) continue;
        if (b.status === 'reserved' && b.start_at <= now && b.plan !== 'noshow' && Math.random() < 0.3) {
          await db.run("UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE id = ? AND status = 'reserved'", now, b.id); changed.add(sp.id);
        } else if (b.status === 'checked_in' && b.start_at <= now && Math.random() < 0.01) {
          await db.run("UPDATE bookings SET status = 'on_break', break_started_at = ?, breaks_used = breaks_used + 1 WHERE id = ? AND status = 'checked_in'", now, b.id); changed.add(sp.id);
        } else if (b.status === 'on_break' && b.plan !== 'overrun' && now - b.break_started_at > 2 * MIN && Math.random() < 0.12) {
          await db.run("UPDATE bookings SET status = 'checked_in', break_started_at = NULL WHERE id = ? AND status = 'on_break'", b.id); changed.add(sp.id);
        }
      }
    }

    const diff = target - inUse;
    if (diff > 0) {
      const room = initial ? diff : Math.min(diff, 1 + Math.ceil(ids.length / 60));
      const taken = new Set(here.map((b) => b.seat_id));
      const free = ids.filter((id) => !taken.has(id)).sort(() => Math.random() - 0.5);
      let made = 0;
      for (const seatId of free) {
        if (made >= room) break;
        if (initial) { startupRows.push(startupRow(seatId, now)); made++; }
        else if (await newDemoBooking(db, seatId, now)) made++;
      }
      if (made) changed.add(sp.id);
    } else if (diff < -1 && !initial) {
      const leaving = here.filter((b) => b.is_demo && b.status === 'checked_in').sort(() => Math.random() - 0.5)
        .slice(0, Math.min(-diff, 1 + Math.floor(ids.length / 80)));
      for (const b of leaving) {
        await db.run("UPDATE bookings SET status = 'completed', ended_at = ?, end_reason = 'Checked out' WHERE id = ? AND status = 'checked_in'", now, b.id);
      }
      if (leaving.length) changed.add(sp.id);
    }
  }
  if (startupRows.length) {
    await db.tx((t) => insertMany(t, 'bookings', ['user_id', 'seat_id', 'start_at', 'end_at', 'status', 'checked_in_at', 'is_demo', 'plan', 'created_at'], startupRows));
  }
  return changed;
}
