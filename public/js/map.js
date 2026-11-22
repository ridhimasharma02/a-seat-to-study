// Floor plan drawing: tables with chairs, quiet carrels, or group rooms.
import { html, raw, icon, fmtTime } from './ui.js';

export const STATUS_TEXT = {
  available: 'Available', occupied: 'Occupied', break: 'On a break', reserved: 'Reserved', mine: 'Your seat',
};

export function seatTitle(s) {
  const bits = [s.label, STATUS_TEXT[s.status]];
  if (s.status === 'occupied' && s.info?.until) bits.push(`until ${fmtTime(s.info.until)}`);
  if (s.status === 'break' && s.info?.back_by) bits.push(`back by ${fmtTime(s.info.back_by)}`);
  if (s.status === 'reserved' && s.info?.from) bits.push(`from ${fmtTime(s.info.from)}`);
  if (s.power) bits.push(s.power_ok ? 'power socket' : 'socket not working');
  return bits.join(' · ');
}

function seatButton(s, opts) {
  const dim = (opts.onlyPower && !(s.power && s.power_ok)) || (opts.onlyFree && s.status !== 'available');
  const cls = ['seat', `st-${s.status}`, s.id === opts.selected ? 'sel' : '', dim ? 'dim' : '', s.capacity > 1 ? 'room-seat' : ''].join(' ');
  const plug = s.power ? html`<i class="plug ${s.power_ok ? '' : 'broken'}">${s.power_ok ? icon.bolt() : icon.noBolt()}</i>` : '';
  return html`<button type="button" class="${cls}" data-seat="${s.id}" title="${seatTitle(s)}" aria-label="${seatTitle(s)}" aria-pressed="${s.id === opts.selected}">${s.capacity > 1 ? html`<b>${s.label}</b><small>up to ${s.capacity}</small>` : s.label}${plug}</button>`;
}

function groups(seats) {
  const map = new Map();
  for (const s of seats) { if (!map.has(s.grp)) map.set(s.grp, []); map.get(s.grp).push(s); }
  return [...map.entries()];
}

export function floorPlan(space, seats, opts = {}) {
  let body;
  if (space.layout === 'tables6' || space.layout === 'tables4') {
    const half = space.layout === 'tables6' ? 3 : 2;
    body = html`<div class="tables" style="--cols:${space.cols}">
      ${groups(seats).map(([grp, list]) => html`
        <div class="table-set">
          <div class="chairs">${list.filter((s) => s.pos < half).map((s) => seatButton(s, opts))}</div>
          <div class="desk" aria-hidden="true">${grp}</div>
          <div class="chairs">${list.filter((s) => s.pos >= half).map((s) => seatButton(s, opts))}</div>
        </div>`)}
    </div>`;
  } else if (space.layout === 'carrels') {
    body = html`<div class="carrels">
      ${groups(seats).map(([grp, list]) => html`<div class="carrel-row"><span class="row-name">${grp}</span>
        ${list.map((s) => html`<div class="carrel"><span class="carrel-desk" aria-hidden="true"></span>${seatButton(s, opts)}</div>`)}</div>`)}
    </div>`;
  } else {
    body = html`<div class="rooms">${seats.map((s) => html`<div class="room">${seatButton(s, opts)}</div>`)}</div>`;
  }
  return html`<div class="floor layout-${space.layout}">
    <div class="shelves" aria-hidden="true"><span>Bookshelves</span></div>
    <div class="floor-body">${body}</div>
    <div class="landmarks" aria-hidden="true"><span>Help desk</span><span class="door">Entrance</span></div>
  </div>`;
}

export const legend = raw(`<ul class="legend">
  <li><i class="sw st-available"></i>Available</li>
  <li><i class="sw st-occupied"></i>Occupied</li>
  <li><i class="sw st-break"></i>On a break</li>
  <li><i class="sw st-reserved"></i>Reserved</li>
  <li><i class="sw st-mine"></i>Your seat</li>
  <li><i class="plug-key">${String(icon.bolt(13))}</i>Power socket</li>
  <li><i class="plug-key broken">${String(icon.noBolt(13))}</i>Socket not working</li>
</ul>`);
