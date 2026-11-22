// Where a desk's QR sticker points: /checkin?seat=ID&code=XXXX
import { post } from '../api.js';
import { html, bigCheck, icon, fmtTime } from '../ui.js';

export async function render(ctx) {
  const seat = Number(ctx.query.get('seat'));
  const code = ctx.query.get('code') || '';
  try {
    const r = await post('/api/checkin', { seat_id: seat, code });
    const b = r.booking;
    ctx.main.innerHTML = String(html`
      <section class="page narrow"><div class="card center reserved-done">
        ${bigCheck}
        <h1 class="hand">You're checked in!</h1>
        <p><b>Seat ${b.seat.label}</b> · ${b.space.name} (${b.space.area})</p>
        <p class="note">Your seat is yours until <b>${fmtTime(b.end_at)}</b>. Going for chai? Start a break in My Bookings so it isn't released.</p>
        <a class="btn primary" href="/bookings" data-link>Open My Bookings</a>
      </div></section>`);
  } catch (e) {
    ctx.main.innerHTML = String(html`
      <section class="page narrow"><div class="card center">
        <div class="placeholder">${icon.qr(36)}</div>
        <h1>Couldn't check you in</h1>
        <p>${e.message}</p>
        <p><a class="btn primary" href="/bookings" data-link>My Bookings</a> <a class="btn" href="/spaces" data-link>Find a Space</a></p>
      </div></section>`);
  }
}
