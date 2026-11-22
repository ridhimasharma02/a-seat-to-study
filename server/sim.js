// Demo activity: simulated students reserve, check in, take breaks and leave,
// so the prototype feels like a real evening in the library. Real accounts are never touched.
import { MIN, targetShare } from './config.js';
import { createBooking, seatIsFree } from './bookings.js';
import { tx } from './db.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function newDemoBooking(db, seatId, demoUsers, now, { settled = false } = {}) {
  const duration = pick([60, 90, 120, 150, 180]);
  let start = now, status = 'reserved', plan = null;
  const roll = Math.random();
  if (settled || roll < 0.2) {
    // already sitting there (on first start-up, they've been there a while)
    status = 'checked_in';
    if (settled) start = now - between(1, 22) * 5 * MIN;
  } else if (roll < 0.4) {
    start = now + between(3, 9) * 5 * MIN; // booked for later
  }
  if (status === 'reserved' && Math.random() < 0.12) plan = 'noshow';
  if (Math.random() < 0.05) plan = 'overrun';
  let end = start + duration * MIN;
  if (end <= now + 10 * MIN) end = now + between(2, 8) * 10 * MIN;
  if (!seatIsFree(db, seatId, start, end)) return false;
  const id = createBooking(db, { userId: pick(demoUsers), seatId, start, durationMin: duration, now: start, isDemo: 1, plan, status });
  if (end !== start + duration * MIN || status === 'checked_in') {
    db.q('UPDATE bookings SET end_at = ?, checked_in_at = ? WHERE id = ?').run(end, status === 'checked_in' ? start + between(0, 8) * MIN : null, id);
  }
  return true;
}

export function simulate(db, now, { initial = false } = {}) {
  const changed = new Set();
  const demoUsers = db.q('SELECT id FROM users WHERE is_demo = 1').all().map((r) => r.id);
  const hour = new Date(now).getHours();
  tx(db, () => {
    for (const sp of db.q('SELECT id, base FROM spaces').all()) {
      const seats = db.q('SELECT id FROM seats WHERE space_id = ?').all(sp.id).map((r) => r.id);
      const active = db.q(`SELECT b.* FROM bookings b JOIN seats s ON s.id = b.seat_id
                           WHERE s.space_id = ? AND b.status IN ('reserved','checked_in','on_break') AND b.end_at > ?`).all(sp.id, now);
      const inUse = active.filter((b) => b.start_at <= now).length;
      const target = Math.round(seats.length * targetShare(sp.base, hour));

      if (!initial) {
        for (const b of active) {
          if (!b.is_demo) continue;
          if (b.status === 'reserved' && b.start_at <= now && b.plan !== 'noshow' && Math.random() < 0.3) {
            db.q("UPDATE bookings SET status = 'checked_in', checked_in_at = ? WHERE id = ?").run(now, b.id); changed.add(sp.id);
          } else if (b.status === 'checked_in' && b.start_at <= now && Math.random() < 0.01) {
            db.q("UPDATE bookings SET status = 'on_break', break_started_at = ?, breaks_used = breaks_used + 1 WHERE id = ?").run(now, b.id); changed.add(sp.id);
          } else if (b.status === 'on_break' && b.plan !== 'overrun' && now - b.break_started_at > 2 * MIN && Math.random() < 0.12) {
            db.q("UPDATE bookings SET status = 'checked_in', break_started_at = NULL WHERE id = ?").run(b.id); changed.add(sp.id);
          }
        }
      }

      const diff = target - inUse;
      if (diff > 0) {
        const room = initial ? diff : Math.min(diff, 1 + Math.ceil(seats.length / 60));
        const taken = new Set(active.map((b) => b.seat_id));
        const free = seats.filter((id) => !taken.has(id)).sort(() => Math.random() - 0.5);
        let made = 0;
        for (const seatId of free) {
          if (made >= room) break;
          if (newDemoBooking(db, seatId, demoUsers, now, { settled: initial && Math.random() < 0.9 })) made++;
        }
        if (made) changed.add(sp.id);
      } else if (diff < -1 && !initial) {
        const leaving = active.filter((b) => b.is_demo && b.status === 'checked_in').sort(() => Math.random() - 0.5)
          .slice(0, Math.min(-diff, 1 + Math.floor(seats.length / 80)));
        for (const b of leaving) {
          db.q("UPDATE bookings SET status = 'completed', ended_at = ?, end_reason = 'Checked out' WHERE id = ?").run(now, b.id);
        }
        if (leaving.length) changed.add(sp.id);
      }
    }
  });
  return changed;
}
