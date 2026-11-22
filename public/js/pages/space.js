// Screens 3 and 4 of the paper prototype: Library Seat Map and Book a Seat.
import { api, post } from '../api.js';
import { html, raw, icon, bigCheck, whenPicker, bindWhen, fmtTime, fmtDay, fmtRange, fmtDur, now, toast, busy } from '../ui.js';
import { floorPlan, legend, STATUS_TEXT } from '../map.js';
import { isoSvg, isoControls, bindIso, ISO_DEFAULT } from '../iso.js';

const savedView = () => { try { return localStorage.getItem('sts-map-view'); } catch { return null; } };
const saveView = (v) => { try { localStorage.setItem('sts-map-view', v); } catch { /* private mode */ } };

export async function render(ctx) {
  const id = ctx.params[0];
  const st = {
    win: { start: Number(ctx.query.get('start')) || 0, dur: Number(ctx.query.get('dur')) || 60 },
    selected: Number(ctx.query.get('seat')) || null,
    onlyPower: false, onlyFree: false,
    confirmed: null,
    view: (ctx.query.get('view') || savedView()) === '3d' ? '3d' : '2d',
    iso: { ...ISO_DEFAULT },
  };
  let data;

  async function load() {
    const p = new URLSearchParams();
    if (st.win.start) p.set('start', st.win.start);
    p.set('dur', st.win.dur);
    data = await api(`/api/spaces/${id}?${p}`);
  }

  const zone = (s) => data.space.layout === 'carrels' ? 'Quiet zone · single carrel'
    : data.space.layout === 'rooms' ? `Group room for up to ${s.capacity}`
    : `Shared table ${s.grp}`;
  function syncUrl() {
    const p = new URLSearchParams();
    if (st.win.start) p.set('start', st.win.start);
    if (st.win.dur !== 60) p.set('dur', st.win.dur);
    if (st.view === '3d') p.set('view', '3d');
    history.replaceState({}, '', `/spaces/${id}${p.toString() ? `?${p}` : ''}`);
  }

  const winText = () => {
    const start = st.win.start || now();
    return { date: fmtDay(start), time: st.win.start ? fmtRange(start, start + st.win.dur * 60000) : `From now, for ${fmtDur(st.win.dur)}` };
  };

  function shell() {
    const sp = data.space;
    ctx.main.innerHTML = String(html`
      <section class="page wide">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/spaces" data-link>Spaces</a><span>›</span><b>${sp.name}</b><span>›</span><span>${sp.area}</span></nav>
        <div class="map-head">
          <div><h1 class="page-title">${sp.name} <span class="muted">(${sp.area})</span></h1>
            <p class="muted">${sp.blurb} ${sp.block}.</p></div>
          <div id="when">${whenPicker(st.win)}</div>
        </div>
        <div class="map-layout">
          <aside class="card map-side">
            <div class="seg" role="group" aria-label="Map view">
              <button type="button" data-view="2d" aria-pressed="${st.view === '2d'}">Floor plan</button>
              <button type="button" data-view="3d" aria-pressed="${st.view === '3d'}">3D view</button>
            </div>
            ${legend}
            <div class="toggles">
              <label class="check"><input type="checkbox" id="only-power" ${raw(st.onlyPower ? 'checked' : '')}><span>Only seats with a working socket</span></label>
              <label class="check"><input type="checkbox" id="only-free" ${raw(st.onlyFree ? 'checked' : '')}><span>Only free seats</span></label>
            </div>
            <p class="counts" id="counts"></p>
          </aside>
          <div class="card map-wrap"><div id="map"></div></div>
          <aside class="card details" id="details" aria-live="polite"></aside>
        </div>
      </section>`);
    const bind = () => bindWhen(ctx.main.querySelector('#when'), st.win, async (w) => {
      st.win = w; st.confirmed = null;
      ctx.main.querySelector('#when').innerHTML = String(whenPicker(st.win)); bind();
      syncUrl();
      await load(); drawMap(); drawDetails();
    });
    bind();
    ctx.main.querySelector('#only-power').addEventListener('change', (e) => { st.onlyPower = e.target.checked; drawMap(); });
    ctx.main.querySelector('#only-free').addEventListener('change', (e) => { st.onlyFree = e.target.checked; drawMap(); });
    ctx.main.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      st.view = b.dataset.view; saveView(st.view); syncUrl();
      ctx.main.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === st.view)));
      ctx.main.querySelector('#map').innerHTML = ''; drawMap(); drawDetails();
    }));
    ctx.main.querySelector('#map').addEventListener('click', (e) => {
      if (e.currentTarget.dataset.dragged) return; // that was a drag to turn the 3D room, not a click
      const b = e.target.closest('[data-seat]'); if (!b) return;
      st.selected = Number(b.dataset.seat); st.confirmed = null; drawMap(); drawDetails();
      if (window.innerWidth < 1000) ctx.main.querySelector('#details').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function drawMap() {
    const host = ctx.main.querySelector('#map');
    if (st.view === '3d') {
      if (!host.querySelector('.iso-stage')) {
        host.innerHTML = isoControls;
        bindIso(host, st.iso, () => { host.querySelector('.iso-stage').innerHTML = isoSvg(data.space, data.seats, st.iso, st); });
      }
      host.querySelector('.iso-stage').innerHTML = isoSvg(data.space, data.seats, st.iso, st);
    } else {
      host.innerHTML = String(floorPlan(data.space, data.seats, st));
    }
    const sp = data.space;
    ctx.main.querySelector('#counts').innerHTML = String(html`<b>${sp.free}</b> of ${sp.total} ${sp.unit}s free${st.win.start ? ' at that time' : ''}<br>
      ${sp.unit === 'seat' ? html`<b>${sp.power_free}</b> free with a working socket` : ''}`);
  }

  function drawDetails() {
    const el = ctx.main.querySelector('#details');
    if (st.confirmed) {
      const b = st.confirmed;
      el.innerHTML = String(html`
        <div class="reserved-done">
          ${bigCheck}
          <h2 class="hand">Seat Reserved!</h2>
          <p><b>Seat ${b.seat.label}</b> · ${b.space.name} (${b.space.area})<br>${fmtDay(b.start_at)}, ${fmtRange(b.start_at, b.end_at)}</p>
          <p class="note">${b.checkin_opens_at <= now()
            ? html`Check in at the desk by <b>${fmtTime(b.checkin_deadline)}</b>`
            : html`Check in at the desk between <b>${fmtTime(b.checkin_opens_at)}</b> and <b>${fmtTime(b.checkin_deadline)}</b>`} by scanning its QR sticker. If you don't, the seat goes back to everyone.</p>
          <a class="btn primary wide" href="/bookings" data-link>View My Bookings</a>
          <button class="btn ghost wide" type="button" id="again">Back to the map</button>
        </div>`);
      el.querySelector('#again').addEventListener('click', () => { st.confirmed = null; st.selected = null; drawMap(); drawDetails(); });
      return;
    }
    const s = data.seats.find((x) => x.id === st.selected);
    if (!s) {
      el.innerHTML = String(html`<h2>Seat Details</h2>
        <div class="placeholder">${icon.seat(34)}<p>Pick a <b class="green">green</b> seat ${st.view === '3d' ? 'in the 3D room' : 'on the map'} to see its details and reserve it.</p>
        ${st.view === '2d' ? html`<p class="small">Want to see the room? Switch to <b>3D view</b> above the map.</p>` : ''}</div>`);
      return;
    }
    const w = winText();
    const power = !s.power ? 'No socket' : s.power_ok ? 'Working socket' : 'Socket not working';
    let action;
    if (s.status === 'available') {
      action = html`<button class="btn primary wide" id="reserve" type="button">Reserve ${data.space.unit === 'room' ? 'this room' : 'this seat'}</button>
        <p class="muted small center">Check in within ${ctx.rules.CHECKIN_GRACE_MIN} minutes of the start, or it is released.</p>
`;
    } else if (s.status === 'mine') {
      action = html`<p class="state mine">This is your seat${s.info ? html` (${fmtRange(s.info.from, s.info.until)})` : ''}.</p><a class="btn wide" href="/bookings" data-link>Open My Bookings</a>`;
    } else {
      const why = s.status === 'occupied' ? `Someone is studying here until ${fmtTime(s.info.until)}.`
        : s.status === 'break' ? `Its student is on a break and must be back by ${fmtTime(s.info.back_by)}.`
        : `Reserved ${fmtRange(s.info.from, s.info.until)}.`;
      action = html`<p class="state ${s.status}">${STATUS_TEXT[s.status]}. ${why}</p><p class="muted small">Pick a green seat, or change the time above.</p>
        ${s.status !== 'reserved' ? html`<a class="link small" href="/report?space=${id}&seat=${s.id}" data-link>Only a bag on this seat? Report it</a>` : ''}`;
    }
    el.innerHTML = String(html`
      <h2>Seat Details</h2>
      <dl class="kv">
        <div><dt>Location</dt><dd>${data.space.name}<br><span class="muted">(${data.space.area})</span></dd></div>
        <div><dt>${data.space.unit === 'room' ? 'Room' : 'Seat No.'}</dt><dd class="mono">${s.label}</dd></div>
        <div><dt>Date</dt><dd>${icon.calendar(16)} ${w.date}</dd></div>
        <div><dt>Time</dt><dd>${icon.clock(16)} ${w.time}</dd></div>
        <div><dt>Power</dt><dd>${power}</dd></div>
        <div><dt>Zone</dt><dd>${zone(s)}</dd></div>
      </dl>
      ${action}`);
    el.querySelector('#reserve')?.addEventListener('click', (e) => busy(e.target, async () => {
      try {
        const r = await post('/api/bookings', { seat_id: s.id, start: st.win.start || 'now', duration: st.win.dur });
        st.confirmed = r.booking; toast(`Seat ${s.label} is yours. Check in by ${fmtTime(r.booking.checkin_deadline)}.`);
        await load(); drawMap(); drawDetails();
      } catch (err) { toast(err.message, 'error'); await load(); drawMap(); drawDetails(); }
    }));
  }

  await load();
  shell(); drawMap(); drawDetails();
  return {
    async update(ids) { if (!ids.has(id)) return; await load(); drawMap(); if (!st.confirmed) drawDetails(); },
  };
}
