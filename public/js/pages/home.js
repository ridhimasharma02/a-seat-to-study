// Screen 1 of the paper prototype: Home / Dashboard.
import { api } from '../api.js';
import { html, raw, heroArt, icon, fmtTime, fmtDay, fmtRange } from '../ui.js';

export async function render(ctx) {
  let spaces = [], mine = null;
  async function load() {
    const [s, b] = await Promise.all([api('/api/spaces'), ctx.me ? api('/api/bookings/mine') : Promise.resolve(null)]);
    spaces = s.spaces; mine = b?.active?.[0] || null;
  }
  function draw() {
    const free = spaces.reduce((n, s) => n + (s.unit === 'seat' ? s.free : 0), 0);
    const r = ctx.rules;
    ctx.main.innerHTML = String(html`
      <section class="hero page">
        <div class="hero-text">
          <h1 class="display"><span class="wavy">A Seat to Study</span></h1>
          <p class="lead">Find and reserve study spaces in LPU.</p>
          <p class="live-line"><span class="dot" aria-hidden="true"></span>${free} seats free right now across ${spaces.length} study spaces</p>
          <div class="actions">
            <a class="btn primary big" href="/spaces" data-link>Find a Space ${raw('&rarr;')}</a>
            ${ctx.me ? html`<a class="btn big" href="/bookings" data-link>My Bookings</a>` : html`<a class="btn big" href="/register" data-link>Create an account</a>`}
          </div>
        </div>
        ${heroArt}
      </section>

      ${mine ? html`
        <section class="page">
          <a class="next-booking" href="/bookings" data-link>
            <span class="tag ${mine.status}">${mine.status === 'reserved' ? 'Reserved' : mine.status === 'on_break' ? 'On a break' : 'Checked in'}</span>
            <span><b>Seat ${mine.seat.label}</b> · ${mine.space.name} (${mine.space.area})</span>
            <span class="muted">${fmtDay(mine.start_at)}, ${fmtRange(mine.start_at, mine.end_at)}</span>
            ${mine.status === 'reserved' ? html`<span class="muted">Check in by ${fmtTime(mine.checkin_deadline)}</span>` : ''}
            <span class="go">${icon.chevron()}</span>
          </a>
        </section>` : ''}

      <section class="page two-col">
        <div class="card">
          <div class="card-head"><h2>Free right now</h2><span class="muted small">Updates live</span></div>
          <ul class="free-list">
            ${spaces.map((s) => html`
              <li><a href="/spaces/${s.id}" data-link>
                <span class="fl-name"><b>${s.name}</b> <span class="muted">(${s.area})</span></span>
                <span class="fl-bar" aria-hidden="true"><i style="width:${Math.round(((s.total - s.free) / s.total) * 100)}%"></i></span>
                <span class="fl-num">${s.free} of ${s.total} ${s.unit}s free</span>
                <span class="badge ${s.status.replace(' ', '-').toLowerCase()}">${s.status}</span>
              </a></li>`)}
          </ul>
        </div>
        <div class="card how">
          <h2>How it works</h2>
          <ol class="steps">
            <li><span class="num">1</span><div><b>Find a space</b><p>See free seats in every study space before you leave the hostel. Filter for quiet zones or seats with a working power socket.</p></div></li>
            <li><span class="num">2</span><div><b>Reserve a seat</b><p>Pick a green seat on the floor plan, now or for later today. You can book up to ${r.DURATIONS_MIN.at(-1) / 60} hours.</p></div></li>
            <li><span class="num">3</span><div><b>Check in at the desk</b><p>Scan the QR sticker on your desk within ${r.CHECKIN_GRACE_MIN} minutes of your start time, or the seat goes back to everyone.</p></div></li>
            <li><span class="num">4</span><div><b>Take breaks, then check out</b><p>A break keeps your seat for ${r.BREAK_MAX_MIN} minutes. Check out when you leave so the next student gets it.</p></div></li>
          </ol>
        </div>
      </section>`);
  }
  await load(); draw();
  return { async update() { await load(); draw(); } };
}
