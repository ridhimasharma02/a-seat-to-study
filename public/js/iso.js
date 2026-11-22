// 3D isometric view of a floor, drawn as SVG.
// Every desk, chair, carrel and room is a box in 3D space that we rotate, tilt and project,
// then paint back-to-front (painter's algorithm). Chairs are clickable, just like the floor plan.
import { esc } from './ui.js';
import { seatTitle } from './map.js';

const DEG = Math.PI / 180;
export const ISO_DEFAULT = { theta: -20 * DEG, tilt: 55, zoom: 1 };

// [top, left side, right side, outline] — the sketch's status colours, shaded for 3D.
const PAL = {
  available: ['#D4EEDA', '#B9DFC3', '#9ECFAA', '#2E7A4C'],
  occupied: ['#F7D5E3', '#EEBBD0', '#E1A0BB', '#AD3A69'],
  break: ['#FCEDF4', '#F4D8E4', '#EAC4D5', '#AD3A69'],
  reserved: ['#F8E6AF', '#EFD591', '#E3C473', '#A27C12'],
  mine: ['#CDBFF6', '#B9A8F0', '#A390E7', '#5641AE'],
};
const WOOD = ['#F2EBDD', '#E3D7C2', '#D3C4A9', '#232C63'];
const FLOOR = ['#FBFAF5', '#E9E5D9', '#DCD6C6', '#232C63'];
const WALL = ['#FFFFFF', '#EDEFF6', '#DFE2EE', '#232C63'];
const SHELF = ['#E5DDFB', '#D4C8F7', '#C1B2F0', '#232C63'];
const GLASS = ['rgba(229,221,251,.28)', 'rgba(205,191,246,.30)', 'rgba(182,164,239,.30)', '#5641AE'];

const box = (x0, y0, z0, w, d, h, pal, extra = {}) => ({ x0, y0, z0, x1: x0 + w, y1: y0 + d, z1: z0 + h, pal, ...extra });
function bbox(parts) {
  const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (const p of parts) for (const k of ['x0', 'y0', 'z0']) b[k] = Math.min(b[k], p[k]);
  for (const p of parts) for (const k of ['x1', 'y1', 'z1']) b[k] = Math.max(b[k], p[k]);
  return b;
}

// Turn the seat list into 3D objects (units: roughly half a metre).
function buildScene(space, seats) {
  const objs = [];
  const groups = new Map();
  for (const s of seats) { if (!groups.has(s.grp)) groups.set(s.grp, []); groups.get(s.grp).push(s); }
  const chair = (s, x, y, backOnNorth) => {
    const pal = PAL[s.status] || PAL.available;
    const parts = [box(x, y, 0, 0.8, 0.8, 0.46, pal), box(x, backOnNorth ? y : y + 0.64, 0.46, 0.8, 0.16, 0.62, pal)];
    objs.push({ ...bbox(parts), parts, seat: s });
  };

  if (space.layout === 'tables6' || space.layout === 'tables4') {
    const half = space.layout === 'tables6' ? 3 : 2;
    const tw = (half - 1) * 1.2 + 1.4;
    [...groups.entries()].forEach(([grp, list], gi) => {
      const tx = (gi % space.cols) * (tw + 1.7), ty = Math.floor(gi / space.cols) * 5.0;
      objs.push(box(tx, ty + 1.05, 0, tw, 1.3, 0.78, WOOD, { label: grp }));
      for (const s of list) {
        const north = s.pos < half, i = north ? s.pos : s.pos - half;
        chair(s, tx + 0.3 + i * 1.2, north ? ty : ty + 2.55, north);
      }
    });
  } else if (space.layout === 'carrels') {
    [...groups.values()].forEach((list, ri) => {
      const ry = ri * 2.9;
      for (const s of list) {
        const x = s.pos * 1.45;
        objs.push(box(x, ry, 0.78, 1.25, 0.08, 0.72, WALL));            // privacy screen
        objs.push(box(x, ry + 0.08, 0, 1.25, 0.7, 0.78, WOOD));         // desk
        objs.push(box(x + 1.3, ry, 0, 0.08, 1.05, 1.5, WALL));          // divider
        chair(s, x + 0.22, ry + 1.0, false);
      }
    });
  } else {
    seats.forEach((s, i) => {
      const rx = (i % space.cols) * 6.2, ry = Math.floor(i / space.cols) * 5.4;
      const pal = PAL[s.status] || PAL.available;
      const parts = [
        box(rx, ry, 0, 5, 4, 0.07, pal),                            // room floor shows its status
        box(rx, ry, 0.07, 5, 0.08, 1.7, GLASS),                     // glass walls
        box(rx, ry, 0.07, 0.08, 4, 1.7, GLASS),
        box(rx + 4.92, ry, 0.07, 0.08, 4, 1.7, GLASS),
        box(rx, ry + 3.92, 0.07, 3.1, 0.08, 1.7, GLASS),            // front wall, door gap on the right
        box(rx + 4.1, ry + 3.92, 0.07, 0.9, 0.08, 1.7, GLASS),
        box(rx + 1.4, ry + 1.4, 0.07, 2.2, 1.2, 0.75, WOOD),        // meeting table
      ];
      objs.push({ ...bbox(parts), parts, seat: s, room: true });
    });
  }
  return objs;
}

export function isoSvg(space, seats, view, opts = {}) {
  const objs = buildScene(space, seats);
  const b = bbox(objs);
  const pad = 1.7, shelfRoom = space.layout === 'rooms' ? 0 : 1.3;
  const F = { x0: b.x0 - pad - shelfRoom, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad + 0.8 };
  const cx = (F.x0 + F.x1) / 2, cy = (F.y0 + F.y1) / 2;

  const c = Math.cos(view.theta), s = Math.sin(view.theta);
  const sp = Math.sin(view.tilt * DEG), cp = Math.cos(view.tilt * DEG);
  const K = 24;
  const lim = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const P = (x, y, z) => {
    const X = x - cx, Y = y - cy;
    const sx = (X * c - Y * s) * K, sy = ((X * s + Y * c) * sp - z * cp) * K;
    if (sx < lim.x0) lim.x0 = sx; if (sx > lim.x1) lim.x1 = sx;
    if (sy < lim.y0) lim.y0 = sy; if (sy > lim.y1) lim.y1 = sy;
    return [sx, sy];
  };
  const depth = (o) => { const X = (o.x0 + o.x1) / 2 - cx, Y = (o.y0 + o.y1) / 2 - cy; return (X * s + Y * c) * cp + ((o.z0 + o.z1) / 2) * sp; };
  const faceToward = (nx, ny) => nx * s + ny * c > 1e-4;   // does this side face the viewer?
  const pts = (list) => list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const poly = (list, fill, stroke) => `<polygon points="${pts(list)}" fill="${fill}" stroke="${stroke}"/>`;

  const SIDES = [
    [0, -1, (o) => [[o.x0, o.y0], [o.x1, o.y0]]],
    [0, 1, (o) => [[o.x1, o.y1], [o.x0, o.y1]]],
    [-1, 0, (o) => [[o.x0, o.y1], [o.x0, o.y0]]],
    [1, 0, (o) => [[o.x1, o.y0], [o.x1, o.y1]]],
  ];
  function drawBox(o) {
    let out = '';
    for (const [nx, ny, edge] of SIDES) {
      if (!faceToward(nx, ny)) continue;
      const [a, e] = edge(o);
      const light = nx * c - ny * s < 0;
      out += poly([P(a[0], a[1], o.z0), P(e[0], e[1], o.z0), P(e[0], e[1], o.z1), P(a[0], a[1], o.z1)], light ? o.pal[1] : o.pal[2], o.pal[3]);
    }
    out += poly([P(o.x0, o.y0, o.z1), P(o.x1, o.y0, o.z1), P(o.x1, o.y1, o.z1), P(o.x0, o.y1, o.z1)], o.pal[0], o.pal[3]);
    if (o.label) { const [lx, ly] = P((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, o.z1); out += `<text class="iso-lbl" x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}">${esc(o.label)}</text>`; }
    return out;
  }

  // the room: floor slab, walls on the two far sides, shelves, help desk, entrance mat
  let back = drawBox(box(F.x0, F.y0, -0.3, F.x1 - F.x0, F.y1 - F.y0, 0.3, FLOOR));
  const walls = [
    [0, -1, box(F.x0, F.y0 - 0.2, -0.3, F.x1 - F.x0, 0.2, 2.6, WALL)],
    [0, 1, box(F.x0, F.y1, -0.3, F.x1 - F.x0, 0.2, 2.6, WALL)],
    [-1, 0, box(F.x0 - 0.2, F.y0 - 0.2, -0.3, 0.2, F.y1 - F.y0 + 0.4, 2.6, WALL)],
    [1, 0, box(F.x1, F.y0 - 0.2, -0.3, 0.2, F.y1 - F.y0 + 0.4, 2.6, WALL)],
  ];
  for (const [nx, ny, w] of walls) if (!faceToward(nx, ny)) back += drawBox(w); // only the walls behind everything
  const mat = [P(F.x1 - 4.2, F.y1 - 0.9, 0.01), P(F.x1 - 1.2, F.y1 - 0.9, 0.01), P(F.x1 - 1.2, F.y1, 0.01), P(F.x1 - 4.2, F.y1, 0.01)];
  const [mx, my] = P(F.x1 - 2.7, F.y1 - 0.45, 0.01);
  back += `${poly(mat, '#E5DDFB', '#5641AE')}<text class="iso-floor-lbl" x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}">ENTRANCE</text>`;

  const extras = [box(F.x0 + 0.6, F.y1 - 1.6, 0, 3.2, 1.0, 1.05, WALL, { label: 'Help desk' })];
  if (shelfRoom) {
    const tall = !faceToward(-1, 0) ? 2.1 : 0.7; // full-height shelves when that wall is at the back
    for (let y = F.y0 + 0.4; y + 2.0 <= F.y1 - 2.0; y += 2.3) extras.push(box(F.x0 + 0.15, y, 0, 0.7, 2.0, tall, SHELF));
  }

  const items = [...objs, ...extras].map((o) => ({ o, d: depth(o) })).sort((a, z) => a.d - z.d);
  let body = '', tags = '';
  for (const { o } of items) {
    if (!o.seat) { body += drawBox(o); continue; }
    const st = o.seat;
    const parts = [...o.parts].map((p) => ({ p, d: depth(p) })).sort((a, z) => a.d - z.d).map(({ p }) => drawBox(p)).join('');
    const dim = (opts.onlyPower && !(st.power && st.power_ok)) || (opts.onlyFree && st.status !== 'available');
    let plug = '';
    if (st.power && !o.room) {
      const [px, py] = P((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 1.42);
      plug = st.power_ok
        ? `<circle class="iso-plug" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.6"/><path class="iso-bolt" d="M${(px + 0.6).toFixed(1)} ${(py - 3).toFixed(1)}l-2.6 3.6h2l-.6 2.6 2.6-3.6h-2z"/>`
        : `<circle class="iso-plug broken" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.6"/><path class="iso-slash" d="M${(px - 3).toFixed(1)} ${(py - 3).toFixed(1)}l6 6"/>`;
    }
    const title = esc(seatTitle(st));
    const isSel = st.id === opts.selected;
    const g = 0.28; // how far the selection ring reaches past the chair
    const ring = isSel ? poly([P(o.x0 - g, o.y0 - g, 0.02), P(o.x1 + g, o.y0 - g, 0.02), P(o.x1 + g, o.y1 + g, 0.02), P(o.x0 - g, o.y1 + g, 0.02)], 'rgba(86,65,174,.28)', '#5641AE') : '';
    let hit;
    if (o.room) hit = '';
    else { const [hx, hy] = P((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 0.55); hit = `<circle class="iso-hit" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="13"/>`; }
    body += `<g class="iso-seat st-${st.status}${isSel ? ' sel' : ''}${dim ? ' dim' : ''}" data-seat="${st.id}" data-tip="${title}" role="button" tabindex="0" aria-label="${title}" aria-pressed="${isSel}">${ring}${parts}${plug}${hit}</g>`;
    if (o.room || st.id === opts.selected || st.status === 'mine') {
      const [tx, ty] = P((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, o.room ? 2.4 : 2.1);
      const w = st.label.length * 7 + 14;
      tags += `<g class="iso-tag${st.status === 'mine' ? ' mine' : ''}${st.id === opts.selected ? ' sel' : ''}"><rect x="${(tx - w / 2).toFixed(1)}" y="${(ty - 11).toFixed(1)}" width="${w}" height="17" rx="5"/><text x="${tx.toFixed(1)}" y="${(ty + 1.5).toFixed(1)}">${esc(st.label)}</text></g>`;
    }
  }
  const m = 14;
  const vb = [lim.x0 - m, lim.y0 - m - 12, lim.x1 - lim.x0 + m * 2, lim.y1 - lim.y0 + m * 2 + 12].map((v) => v.toFixed(1)).join(' ');
  // zoom 1 fits the whole room in the frame; zooming in makes it bigger and the frame scrolls
  const size = view.zoom <= 1 ? `width:${Math.round(100 * view.zoom)}%;max-height:600px` : `width:${Math.round(100 * view.zoom)}%`;
  return `<svg class="iso-svg" viewBox="${vb}" style="${size}" role="group" aria-label="3D view of ${esc(space.name)} (${esc(space.area)}). Seats are buttons.">${back}${body}<g pointer-events="none">${tags}</g></svg>`;
}

export const isoControls = `
  <div class="iso-bar">
    <div class="iso-btns" role="group" aria-label="3D view controls">
      <button type="button" class="btn small" data-iso="left" title="Rotate left">⟲ Rotate</button>
      <button type="button" class="btn small" data-iso="right" title="Rotate right">Rotate ⟳</button>
      <button type="button" class="btn small" data-iso="tilt" title="Change the viewing angle">Tilt</button>
      <button type="button" class="btn small" data-iso="out" title="Zoom out" aria-label="Zoom out">−</button>
      <button type="button" class="btn small" data-iso="in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" class="btn small ghost" data-iso="reset">Reset view</button>
    </div>
    <span class="muted small">Drag to turn the room · click a seat or room to book it</span>
  </div>
  <div class="iso-stage"></div>`;

// Rotate/tilt/zoom buttons, dragging, and keyboard access for the 3D view.
export function bindIso(host, view, redraw) {
  const stage = host.querySelector('.iso-stage');
  // Buttons move a target view; the room glides towards it, so quick clicks add up smoothly.
  const target = { theta: view.theta, tilt: view.tilt };
  let gliding = false;
  const glide = () => {
    if (gliding) return;
    gliding = true;
    const step = () => {
      const dt = target.theta - view.theta, dl = target.tilt - view.tilt;
      if (Math.abs(dt) < 0.003 && Math.abs(dl) < 0.1) { view.theta = target.theta; view.tilt = target.tilt; gliding = false; redraw(); return; }
      view.theta += dt * 0.2; view.tilt += dl * 0.2;
      redraw(); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  host.querySelector('.iso-btns').addEventListener('click', (e) => {
    const act = e.target.closest('[data-iso]')?.dataset.iso;
    if (!act) return;
    if (act === 'left') { target.theta -= 45 * DEG; glide(); }
    if (act === 'right') { target.theta += 45 * DEG; glide(); }
    if (act === 'tilt') { target.tilt = target.tilt >= 64 ? 34 : target.tilt >= 46 ? 68 : 52; glide(); }
    if (act === 'in') { view.zoom = Math.min(2.4, +(view.zoom + 0.2).toFixed(1)); redraw(); }
    if (act === 'out') { view.zoom = Math.max(0.8, +(view.zoom - 0.2).toFixed(1)); redraw(); }
    if (act === 'reset') { view.zoom = 1; target.theta = ISO_DEFAULT.theta; target.tilt = ISO_DEFAULT.tilt; glide(); }
  });

  // floating label that names the seat under the pointer
  host.style.position = 'relative';
  const tip = document.createElement('div');
  tip.className = 'iso-tip'; tip.hidden = true;
  host.appendChild(tip);
  const showTip = (e) => {
    const seat = e.target.closest?.('[data-seat]');
    if (!seat || drag?.moved) { tip.hidden = true; return; }
    const r = host.getBoundingClientRect();
    tip.textContent = seat.dataset.tip;
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 6)}px`;
    tip.style.top = `${e.clientY - r.top + 16}px`;
  };
  stage.addEventListener('pointerover', showTip);
  stage.addEventListener('pointermove', showTip);
  stage.addEventListener('pointerleave', () => { tip.hidden = true; });

  let drag = null, frame = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, theta: view.theta, tilt: view.tilt, moved: false, id: e.pointerId };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 9) return; // small wobbles during a click are not a drag
    if (!drag.moved) { drag.moved = true; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); }
    view.theta = target.theta = drag.theta + dx * 0.009;
    view.tilt = target.tilt = Math.max(28, Math.min(75, drag.tilt - dy * 0.25));
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; redraw(); });
  });
  const end = () => {
    if (drag?.moved) { host.dataset.dragged = '1'; setTimeout(() => { delete host.dataset.dragged; }, 0); }
    drag = null; stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-seat]')) { e.preventDefault(); e.target.closest('[data-seat]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
}
