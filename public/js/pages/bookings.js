// My Bookings: check in with the desk code, take a break, check out, cancel.
import { api, post } from '../api.js';
import { html, icon, fmtTime, fmtDay, fmtRange, fmtLeft, fmtIn, now, toast, dialog, busy } from '../ui.js';

const LABEL = { reserved: 'Reserved', checked_in: 'Checked in', on_break: 'On a break', completed: 'Finished', cancelled: 'Cancelled', no_show: 'Released', released: 'Released' };

export async function render(ctx) {
  let data = { active: [], past: [] };
  let tick = null;

  async function load() { data = await api('/api/bookings/mine'); }

  function timer(b) {
    const t = now();
    if (b.status === 'reserved') {
      if (t < b.checkin_opens_at) return { cls: 'calm', text: `Starts in ${fmtIn(b.start_at - t)}`, sub: `Check-in opens at ${fmtTime(b.checkin_opens_at)}` };
      return { cls: 'urgent', text: fmtLeft(b.checkin_deadline - t), sub: `left to check in (by ${fmtTime(b.checkin_deadline)})` };
    }
    if (b.status === 'on_break') return { cls: 'urgent', text: fmtLeft(b.break_deadline - t), sub: `left on your break (back by ${fmtTime(b.break_deadline)})` };
    return { cls: 'calm', text: fmtLeft(b.end_at - t), sub: `left in your session (until ${fmtTime(b.end_at)})` };
  }

  function card(b) {
    const tm = timer(b);
    const canCheckIn = b.status === 'reserved' && now() >= b.checkin_opens_at;
    return html`
      <article class="card booking ${b.status}" data-id="${b.id}">
        <div class="bk-top">
          <span class="tag ${b.status}">${LABEL[b.status]}</span>
          <span class="muted small">${fmtDay(b.start_at)}, ${fmtRange(b.start_at, b.end_at)}</span>
        </div>
        <div class="bk-body">
          <div>
            <h2 class="bk-seat">${b.space.layout === 'rooms' ? '' : 'Seat '}<span class="mono">${b.seat.label}</span></h2>
            <p>${b.space.name} <span class="muted">(${b.space.area})</span></p>
            <p class="small muted">${b.seat.power ? (b.seat.power_ok ? 'Working power socket' : 'Socket not working') : 'No power socket'}</p>
          </div>
          <div class="bk-timer ${tm.cls}"><b data-timer="${b.id}">${tm.text}</b><span>${tm.sub}</span></div>
        </div>
        <div class="bk-actions">
          ${b.status === 'reserved' ? html`
            <button class="btn primary" data-act="checkin" ${canCheckIn ? '' : 'disabled'}>${icon.qr()} Check in at desk</button>
            <button class="btn ghost" data-act="cancel">Cancel booking</button>` : ''}
          ${b.status === 'checked_in' ? html`
            <button class="btn" data-act="break">${icon.coffee()} Take a break (${ctx.rules.BREAK_MAX_MIN} min)</button>
            <button class="btn primary" data-act="checkout">Check out, I'm leaving</button>` : ''}
          ${b.status === 'on_break' ? html`
            <button class="btn primary" data-act="resume">I'm back at my seat</button>
            <button class="btn ghost" data-act="checkout">Check out</button>` : ''}
          <a class="link small" href="/spaces/${b.space.id}?seat=${b.seat.id}" data-link>See on the map</a>
        </div>
      </article>`;
  }

  function draw() {
    ctx.main.innerHTML = String(html`
      <section class="page">
        <h1 class="page-title"><span class="wavy">My Bookings</span></h1>
        ${data.active.length ? data.active.map(card) : html`
          <div class="card empty-state">${icon.seat(34)}<p>You have no seat booked right now.</p><a class="btn primary" href="/spaces" data-link>Find a Space →</a></div>`}
        <h2 class="section-title">Earlier</h2>
        ${data.past.length ? html`<div class="card"><table class="table">
          <thead><tr><th>When</th><th>Seat</th><th>Space</th><th>What happened</th></tr></thead>
          <tbody>${data.past.map((b) => html`<tr>
            <td>${fmtDay(b.start_at)}, ${fmtRange(b.start_at, b.end_at)}</td>
            <td class="mono">${b.seat.label}</td>
            <td>${b.space.name} <span class="muted">(${b.space.area})</span></td>
            <td><span class="tag ${b.status}">${LABEL[b.status]}</span> <span class="muted small">${b.end_reason || ''}</span></td></tr>`)}</tbody>
        </table></div>` : html`<p class="muted">Nothing yet.</p>`}
      </section>`);
    ctx.main.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => act(btn)));
  }

  async function act(btn) {
    const id = Number(btn.closest('[data-id]').dataset.id);
    const b = data.active.find((x) => x.id === id);
    if (btn.dataset.act === 'checkin') return checkinDialog(b);
    const msgs = { break: `Break started. Be back by ${fmtTime(now() + ctx.rules.BREAK_MAX_MIN * 60000)}.`, resume: 'Welcome back.', checkout: 'Checked out. Thanks for freeing the seat!', cancel: 'Booking cancelled.' };
    if (btn.dataset.act === 'cancel' && !confirm(`Cancel your booking for seat ${b.seat.label}?`)) return;
    await busy(btn, async () => {
      try { await post(`/api/bookings/${id}/${btn.dataset.act}`); toast(msgs[btn.dataset.act]); }
      catch (e) { toast(e.message, 'error'); }
      await load(); draw();
    });
  }

  function checkinDialog(b) {
    const dlg = dialog(html`
      <form method="dialog" class="dlg-body" id="ci-form">
        <h2>Check in to seat <span class="mono">${b.seat.label}</span></h2>
        <p>Scan the QR sticker on your desk with your phone camera, or type the 4-letter code printed under it.</p>
        <label class="field"><span>Desk code</span><input id="ci-code" class="code-input" maxlength="4" autocomplete="off" autocapitalize="characters" required pattern="[A-Za-z0-9]{4}"></label>
        <p class="error" id="ci-err" role="alert"></p>
        <div class="dlg-actions">
          <button type="button" class="btn ghost" data-close>Not now</button>
          <button type="submit" class="btn primary" id="ci-go">Check in</button>
        </div>
        <p class="demo-note">Prototype only: no sticker to hand? <button type="button" class="link" id="ci-demo">Show this desk's code</button></p>
      </form>`, { onOpen: (d) => d.querySelector('#ci-code').focus() });
    dlg.querySelector('#ci-demo').addEventListener('click', async () => {
      try { const r = await api(`/api/bookings/${b.id}/desk-code`); dlg.querySelector('#ci-code').value = r.code; }
      catch (e) { dlg.querySelector('#ci-err').textContent = e.message; }
    });
    dlg.querySelector('#ci-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = dlg.querySelector('#ci-go');
      await busy(btn, async () => {
        try {
          await post(`/api/bookings/${b.id}/checkin`, { code: dlg.querySelector('#ci-code').value });
          dlg.close(); toast(`Checked in to seat ${b.seat.label}. Happy studying!`);
          await load(); draw();
        } catch (err) { dlg.querySelector('#ci-err').textContent = err.message; }
      });
    });
  }

  await load(); draw();
  let reloading = false;
  tick = setInterval(() => {
    for (const b of data.active) {
      const el = ctx.main.querySelector(`[data-timer="${b.id}"]`);
      if (!el) continue;
      const tm = timer(b); el.textContent = tm.text;
      const ci = ctx.main.querySelector(`[data-id="${b.id}"] [data-act="checkin"]`);
      if (ci && ci.disabled && now() >= b.checkin_opens_at) ci.disabled = false;
      // a timer ran out: the server releases or ends the booking on its next sweep (every 15 s)
      if (tm.text === '0:00' && !reloading) {
        reloading = true;
        setTimeout(async () => { await load(); draw(); reloading = false; }, 16000);
      }
    }
  }, 1000);
  return {
    destroy() { clearInterval(tick); },
    async update() { if (document.getElementById('dlg').open) return; await load(); draw(); },
  };
}
