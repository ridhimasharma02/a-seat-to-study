// Report a problem with a seat: a bag with nobody there, a dead socket, noise.
import { api, post } from '../api.js';
import { html, raw, icon, fmtDay, fmtTime, toast, busy } from '../ui.js';

export async function render(ctx) {
  const [{ spaces }, { reasons }] = await Promise.all([api('/api/spaces'), api('/api/reports/reasons')]);
  let spaceId = ctx.query.get('space') || spaces[0].id;
  let seatId = Number(ctx.query.get('seat')) || 0;
  let mine = [];

  async function seatsOf(id) { return (await api(`/api/spaces/${id}`)).seats; }
  async function loadMine() { mine = ctx.me ? (await api('/api/reports/mine')).reports : []; }

  async function draw() {
    const seats = await seatsOf(spaceId);
    if (!seats.some((s) => s.id === seatId)) seatId = 0;
    ctx.main.innerHTML = String(html`
      <section class="page">
        <h1 class="page-title"><span class="wavy">Report a Seat</span></h1>
        <div class="report-layout">
          <form class="card form" id="rep">
            <p class="muted">Seen a seat held by a bag for ages, or a socket that doesn't work? Tell the library staff. They check reports and can free the seat.</p>
            <label class="field"><span>Study space</span>
              <select id="r-space">${spaces.map((s) => html`<option value="${s.id}" ${raw(s.id === spaceId ? 'selected' : '')}>${s.name} (${s.area})</option>`)}</select></label>
            <label class="field"><span>Seat</span>
              <select id="r-seat" required><option value="">Choose the seat…</option>
                ${seats.map((s) => html`<option value="${s.id}" ${raw(s.id === seatId ? 'selected' : '')}>${s.label}${s.status !== 'available' ? ' · in use' : ''}</option>`)}</select></label>
            <fieldset class="field"><legend>What's wrong?</legend>
              ${Object.entries(reasons).map(([k, label], i) => html`<label class="radio"><input type="radio" name="reason" value="${k}" ${raw(i === 0 ? 'checked' : '')}><span>${label}</span></label>`)}
            </fieldset>
            <label class="field"><span>Anything else? <span class="muted">(optional)</span></span>
              <textarea id="r-note" rows="3" maxlength="500" placeholder="For example: bag here since 3 pm, nobody came back"></textarea></label>
            <button class="btn primary" type="submit" id="r-go">${icon.flag()} Send report</button>
          </form>
          <div class="card">
            <h2>Your reports</h2>
            ${mine.length ? html`<ul class="report-list">${mine.map((r) => html`<li>
              <div><b class="mono">${r.seat_label}</b> · ${r.space_name} <span class="muted">(${r.space_area})</span></div>
              <div class="small">${r.reason_text}</div>
              <div class="small muted">${fmtDay(r.created_at)}, ${fmtTime(r.created_at)} · ${r.status === 'open' ? html`<span class="tag reserved">Waiting for staff</span>` : html`<span class="tag completed">${r.resolution}</span>`}</div>
              ${r.status !== 'open' && r.handler_name ? html`<div class="small muted">Handled by ${r.handler_name}${r.handler_title ? ` (${r.handler_title})` : ''}${r.staff_note ? html`: “${r.staff_note}”` : ''}</div>` : ''}
            </li>`)}</ul>` : html`<p class="muted">You haven't reported anything yet.</p>`}
          </div>
        </div>
      </section>`);
    ctx.main.querySelector('#r-space').addEventListener('change', async (e) => { spaceId = e.target.value; seatId = 0; await draw(); });
    ctx.main.querySelector('#r-seat').addEventListener('change', (e) => { seatId = Number(e.target.value); });
    ctx.main.querySelector('#rep').addEventListener('submit', (e) => {
      e.preventDefault();
      busy(ctx.main.querySelector('#r-go'), async () => {
        try {
          await post('/api/reports', {
            seat_id: Number(ctx.main.querySelector('#r-seat').value),
            reason: ctx.main.querySelector('input[name="reason"]:checked').value,
            note: ctx.main.querySelector('#r-note').value,
          });
          toast('Thanks. Library staff will check that seat.');
          seatId = 0; await loadMine(); await draw();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  await loadMine(); await draw();
  return { async update(ids) { if (ids.has('reports')) { await loadMine(); await draw(); } } };
}
