// Staff portal: seat reports, seats in use, broken sockets, desk QR stickers.
// Only staff accounts reach this page (the app and the server both check).
import { api, post } from '../api.js';
import { html, raw, icon, fmtTime, fmtRange, fmtDay, toast, busy, dialog, now } from '../ui.js';
import { floorPlan, legend } from '../map.js';
import { setOpenReports } from '../app.js';

const LABEL = { reserved: 'Waiting for check-in', checked_in: 'Checked in', on_break: 'On a break' };
const REASON_SHORT = { bag: 'Bag on seat', socket: 'Socket', noise: 'Noise', other: 'Other' };

function fmtAgo(ms) {
  const m = Math.round((now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : fmtDay(ms);
}

function seatNowText(sn) {
  const who = (x) => `${x.student}${x.is_demo ? ' (demo)' : ''}`;
  if (sn.status === 'free') return html`<b>Not booked by anyone right now.</b> Anything left on this seat is unattended.`;
  if (sn.status === 'on_break') return html`<b>${who(sn)}</b> is on a break and must be back by <b>${fmtTime(sn.back_by)}</b>.`;
  if (sn.status === 'reserved') return html`Reserved by <b>${who(sn)}</b>, who must check in by <b>${fmtTime(sn.checkin_by)}</b>.`;
  return html`Booked and checked in by <b>${who(sn)}</b> until ${fmtTime(sn.until)}.`;
}

function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    s.onload = ok; s.onerror = () => fail(new Error('Could not load the QR code library. Check the internet connection.'));
    document.head.appendChild(s);
  });
}

export async function render(ctx) {
  const tab = ctx.params[0] || 'reports';
  let data;
  let reasonFilter = 'all', seatFilter = 'all', spaceFilter = 'all';
  const notes = new Map();          // notes typed into report cards survive live refreshes
  let known = null;                 // report ids already seen, to announce new ones

  async function load() {
    data = await api('/api/staff/overview');
    setOpenReports(data.reports.length);
    const ids = new Set(data.reports.map((r) => r.id));
    if (known) for (const r of data.reports) if (!known.has(r.id)) toast(`New report: seat ${r.seat_label}, ${r.space_area}`);
    known = ids;
  }

  // ---------- Reports ----------
  function drawReports() {
    const open = data.reports.filter((r) => reasonFilter === 'all' || r.reason === reasonFilter);
    const counts = data.reports.reduce((m, r) => ({ ...m, [r.reason]: (m[r.reason] || 0) + 1 }), {});
    ctx.main.innerHTML = String(html`
      <section class="page">
        <div class="staff-head">
          <div><h1 class="page-title"><span class="wavy">Seat reports</span></h1>
            <p class="muted">${data.reports.length} waiting · ${data.handled_today} handled today (${data.handled_by_me_today} by you)</p></div>
          <div class="chips" role="group" aria-label="Filter reports">
            ${[['all', `All (${data.reports.length})`], ...Object.entries(REASON_SHORT).map(([k, v]) => [k, `${v} (${counts[k] || 0})`])].map(([k, l]) =>
              html`<button type="button" class="chip ${reasonFilter === k ? 'on' : ''}" data-reason="${k}" aria-pressed="${reasonFilter === k}">${l}</button>`)}
          </div>
        </div>
        ${open.length ? html`<div class="report-cards">${open.map((r) => html`
          <article class="card report-card reason-${r.reason}" data-report="${r.id}">
            <div class="rc-top">
              <span class="rc-seat mono">${r.seat_label}</span>
              <span class="rc-where">${r.space_name} <span class="muted">(${r.space_area})</span></span>
              <span class="muted small rc-when">${fmtAgo(r.created_at)}</span>
            </div>
            <p class="rc-reason"><span class="tag reason">${REASON_SHORT[r.reason]}</span> ${r.reason_text}</p>
            ${r.note ? html`<blockquote class="rc-note">“${r.note}”</blockquote>` : ''}
            <p class="small muted">Reported by ${r.user_name} at ${fmtTime(r.created_at)}</p>
            <div class="rc-now"><span class="small">Seat right now:</span> ${seatNowText(r.seat_now)}
              <button type="button" class="link small" data-map="${r.space_id}" data-seat="${r.seat_id}" data-label="${r.seat_label}">Show on map</button></div>
            <label class="field rc-notefield"><span>Note for the record <span class="muted">(optional)</span></span>
              <input data-note="${r.id}" maxlength="300" placeholder="e.g. Bag moved to the help desk" value="${notes.get(r.id) || ''}"></label>
            <div class="row-actions">
              <button class="btn small primary" data-resolve="release">Free the seat</button>
              ${r.power ? html`<button class="btn small" data-resolve="socket">Mark socket broken</button>` : ''}
              <button class="btn small ghost" data-resolve="dismiss">No problem found</button>
            </div>
          </article>`)}</div>`
        : html`<div class="card empty-state">${icon.check(30)}<p>${data.reports.length ? 'No reports of this kind.' : 'No reports waiting. Nice and quiet.'}</p></div>`}

        <h2 class="section-title">Handled recently</h2>
        ${data.recent_reports.length ? html`<div class="card"><div class="table-scroll"><table class="table">
          <thead><tr><th>Seat</th><th>Problem</th><th>Outcome</th><th>Handled by</th><th>When</th></tr></thead>
          <tbody>${data.recent_reports.map((r) => html`<tr>
            <td><b class="mono">${r.seat_label}</b> <span class="muted small">${r.space_area}</span></td>
            <td class="small">${REASON_SHORT[r.reason]}</td>
            <td class="small">${r.resolution}${r.staff_note ? html`<br><span class="muted">“${r.staff_note}”</span>` : ''}</td>
            <td class="small">${r.handler_name || '—'}${r.handler_title ? html`<br><span class="muted">${r.handler_title}</span>` : ''}</td>
            <td class="small">${r.resolved_at ? `${fmtDay(r.resolved_at)}, ${fmtTime(r.resolved_at)}` : ''}</td></tr>`)}</tbody>
        </table></div></div>` : html`<p class="muted">Nothing handled yet.</p>`}
      </section>`);

    ctx.main.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => { reasonFilter = b.dataset.reason; drawReports(); }));
    ctx.main.querySelectorAll('[data-note]').forEach((i) => i.addEventListener('input', () => notes.set(Number(i.dataset.note), i.value)));
    ctx.main.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => showOnMap(b.dataset.map, Number(b.dataset.seat), b.dataset.label)));
    ctx.main.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      const id = Number(b.closest('[data-report]').dataset.report);
      if (b.dataset.resolve === 'release' && !confirm('Free this seat now? Anyone holding it loses the booking.')) return;
      try {
        const r = await post(`/api/staff/reports/${id}/resolve`, { action: b.dataset.resolve, note: notes.get(id) || '' });
        notes.delete(id); toast(r.resolution);
      } catch (e) { toast(e.message, 'error'); }
      await load(); drawReports();
    })));
  }

  async function showOnMap(spaceId, seatId, label) {
    const d = await api(`/api/staff/spaces/${spaceId}`);
    dialog(html`
      <div class="dlg-body">
        <div class="card-head"><h2>Seat ${label} · ${d.space.name} <span class="muted">(${d.space.area})</span></h2>
          <button type="button" class="btn small ghost" data-close>Close</button></div>
        ${legend}
        <div class="map-wrap dlg-map">${floorPlan(d.space, d.seats, { selected: seatId })}</div>
        <p class="small muted">The reported seat has a dark outline.</p>
      </div>`, { onOpen: (dlg) => { dlg.classList.add('wide'); dlg.querySelector('.seat.sel')?.scrollIntoView({ block: 'center', inline: 'center' }); } });
    document.getElementById('dlg').addEventListener('close', () => document.getElementById('dlg').classList.remove('wide'), { once: true });
  }

  // ---------- Seats in use ----------
  function drawSeats() {
    const list = data.active.filter((b) => (seatFilter === 'all' || b.status === seatFilter) && (spaceFilter === 'all' || b.space.id === spaceFilter));
    const inUse = data.spaces.reduce((n, s) => n + s.in_use_now, 0);
    const total = data.spaces.reduce((n, s) => n + s.total, 0);
    ctx.main.innerHTML = String(html`
      <section class="page">
        <div class="staff-head">
          <div><h1 class="page-title"><span class="wavy">Seats in use</span></h1>
            <p class="muted">${inUse} of ${total} seats and rooms in use right now</p></div>
          <div class="inline-form">
            <select id="f-space" aria-label="Study space"><option value="all">All study spaces</option>${data.spaces.map((s) => html`<option value="${s.id}" ${raw(s.id === spaceFilter ? 'selected' : '')}>${s.name} (${s.area})</option>`)}</select>
            <select id="f-status" aria-label="Status">${[['all', 'Everyone'], ['on_break', 'On a break'], ['reserved', 'Waiting for check-in'], ['checked_in', 'Checked in']].map(([v, l]) => html`<option value="${v}" ${raw(v === seatFilter ? 'selected' : '')}>${l}</option>`)}</select>
          </div>
        </div>
        <div class="card">
          <div class="table-scroll tall"><table class="table">
            <thead><tr><th>Seat</th><th>Space</th><th>Student</th><th>Status</th><th>Time</th><th></th></tr></thead>
            <tbody>${list.slice(0, 200).map((b) => html`<tr>
              <td class="mono">${b.seat.label}</td><td>${b.space.name} <span class="muted">(${b.space.area})</span></td>
              <td>${b.user_name}${b.is_demo ? html` <span class="muted small">(demo)</span>` : ''}</td>
              <td><span class="tag ${b.status}">${LABEL[b.status]}</span>${b.status === 'on_break' ? html` <span class="small muted">back by ${fmtTime(b.break_deadline)}</span>` : ''}${b.status === 'reserved' ? html` <span class="small muted">by ${fmtTime(b.checkin_deadline)}</span>` : ''}</td>
              <td class="small">${fmtRange(b.start_at, b.end_at)}</td>
              <td><button class="btn small ghost" data-release="${b.seat.id}">Free seat</button></td></tr>`)}</tbody>
          </table></div>
          ${list.length > 200 ? html`<p class="small muted">Showing 200 of ${list.length}. Filter by study space to see the rest.</p>` : ''}
          ${!list.length ? html`<p class="muted">Nobody matches this filter.</p>` : ''}
        </div>
        <div class="card">
          <h2>Demo activity</h2>
          <label class="check"><input type="checkbox" id="demo" ${raw(data.demo_activity ? 'checked' : '')}><span>Simulated students come and go (for demos)</span></label>
        </div>
      </section>`);
    ctx.main.querySelector('#f-space').addEventListener('change', (e) => { spaceFilter = e.target.value; drawSeats(); });
    ctx.main.querySelector('#f-status').addEventListener('change', (e) => { seatFilter = e.target.value; drawSeats(); });
    ctx.main.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      if (!confirm('Free this seat now? The student will lose it.')) return;
      await post(`/api/staff/seats/${b.dataset.release}/release`); toast('Seat freed.'); await load(); drawSeats();
    })));
    ctx.main.querySelector('#demo').addEventListener('change', async (e) => {
      const r = await post('/api/staff/settings', { demo_activity: e.target.checked });
      toast(r.demo_activity ? 'Demo activity is on.' : 'Demo activity is off. Only real bookings change the seats now.');
    });
  }

  // ---------- Sockets ----------
  async function drawSockets() {
    ctx.main.innerHTML = String(html`
      <section class="page">
        <div class="staff-head"><div><h1 class="page-title"><span class="wavy">Power sockets</span></h1>
          <p class="muted">Seats with a broken socket are hidden from the "working socket" filters students use.</p></div></div>
        <div class="two-col">
          <div class="card">
            <h2>${icon.bolt(16)} Not working (${data.broken_sockets.length})</h2>
            ${data.broken_sockets.length ? html`<ul class="plain sockets">${data.broken_sockets.map((s) => html`<li><span><b class="mono">${s.label}</b> · ${s.space_name} <span class="muted">(${s.space_area})</span></span><button class="btn small" data-fix="${s.id}">Mark fixed</button></li>`)}</ul>` : html`<p class="muted">All sockets work.</p>`}
          </div>
          <div class="card">
            <h2>Mark a socket broken</h2>
            <p class="small muted">Found a dead socket on your rounds? Mark it here.</p>
            <label class="field"><span>Study space</span><select id="k-space">${data.spaces.filter((s) => s.unit === 'seat').map((s) => html`<option value="${s.id}">${s.name} (${s.area})</option>`)}</select></label>
            <label class="field"><span>Seat</span><select id="k-seat"></select></label>
            <button class="btn" id="k-go">Mark socket broken</button>
          </div>
        </div>
      </section>`);
    ctx.main.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      await post(`/api/staff/seats/${b.dataset.fix}/power`, { ok: true }); toast('Socket marked as working.'); await load(); drawSockets();
    })));
    const fillSeats = async () => {
      const d = await api(`/api/staff/spaces/${ctx.main.querySelector('#k-space').value}`);
      ctx.main.querySelector('#k-seat').innerHTML = String(html`${d.seats.filter((s) => s.power && s.power_ok).map((s) => html`<option value="${s.id}">${s.label}</option>`)}`);
    };
    ctx.main.querySelector('#k-space').addEventListener('change', fillSeats);
    ctx.main.querySelector('#k-go').addEventListener('click', (e) => busy(e.target, async () => {
      const id = ctx.main.querySelector('#k-seat').value; if (!id) return;
      await post(`/api/staff/seats/${id}/power`, { ok: false }); toast('Socket marked as not working.'); await load(); await drawSockets();
    }));
    await fillSeats();
  }

  // ---------- Desk stickers ----------
  async function drawStickers() {
    ctx.main.innerHTML = String(html`
      <section class="page">
        <div class="staff-head"><div><h1 class="page-title"><span class="wavy">Desk QR stickers</span></h1>
          <p class="muted">Print one sticker per desk. Students scan it with their phone camera to check in.</p></div>
          <div class="inline-form no-print">
            <select id="st-space" aria-label="Study space">${data.spaces.map((s) => html`<option value="${s.id}">${s.name} (${s.area})</option>`)}</select>
            <button class="btn primary" id="print">Print</button>
          </div></div>
        <div id="stickers"><p class="muted">Loading stickers…</p></div>
      </section>`);
    const show = async () => {
      const el = ctx.main.querySelector('#stickers');
      try {
        await loadQrLib();
        const st = await api(`/api/staff/desk-codes?space=${ctx.main.querySelector('#st-space').value}`);
        el.innerHTML = String(html`<div class="card print-area">
          <p class="small muted no-print">Each code opens ${st.base_url}/checkin. Phones must be on the same Wi-Fi as this computer.</p>
          <div class="stickers">${st.seats.map((s) => {
            const qr = window.qrcode(0, 'M'); qr.addData(`${st.base_url}/checkin?seat=${s.id}&code=${s.code}`); qr.make();
            return html`<div class="sticker">${raw(qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true }))}
              <div><b>A Seat to Study</b><span class="mono big">${s.label}</span><span class="small">Code <b class="mono">${s.code}</b></span><span class="tiny">Scan to check in</span></div></div>`;
          })}</div></div>`);
      } catch (e) { el.innerHTML = String(html`<p class="error">${e.message}</p>`); }
    };
    ctx.main.querySelector('#st-space').addEventListener('change', show);
    ctx.main.querySelector('#print').addEventListener('click', () => window.print());
    await show();
  }

  const draw = { reports: drawReports, seats: drawSeats, sockets: drawSockets, stickers: drawStickers }[tab];
  await load(); await draw();
  return {
    async update() {
      await load();
      if (tab === 'stickers') return;                                       // don't rebuild the stickers while printing
      if (document.getElementById('dlg').open) return;
      if (ctx.main.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return; // someone is typing
      await draw();
    },
  };
}
