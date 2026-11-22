// Screen 2 of the paper prototype: Find a Study Space (filters, search, list).
import { api } from '../api.js';
import { html, raw, icon, whenPicker, bindWhen, fmtDay, fmtRange, fmtDur } from '../ui.js';

const FILTERS = [
  ['library', 'Library'],
  ['academic', 'Academic Block'],
  ['quiet', 'Quiet Study'],
  ['group', 'Group Study'],
];

export async function render(ctx) {
  const q = ctx.query;
  const st = {
    kinds: new Set((q.get('kinds') || '').split(',').filter(Boolean)),
    power: q.get('power') === '1',
    text: q.get('q') || '',
    win: { start: Number(q.get('start')) || 0, dur: Number(q.get('dur')) || 60 },
  };
  let data = { spaces: [] };

  const params = () => {
    const p = new URLSearchParams();
    if (st.kinds.size) p.set('kinds', [...st.kinds].join(','));
    if (st.power) p.set('power', '1');
    if (st.text) p.set('q', st.text);
    if (st.win.start) p.set('start', st.win.start);
    if (st.win.dur !== 60) p.set('dur', st.win.dur);
    return p;
  };
  const winParams = () => { const p = new URLSearchParams(); if (st.win.start) p.set('start', st.win.start); if (st.win.dur !== 60) p.set('dur', st.win.dur); const s = p.toString(); return s ? `?${s}` : ''; };

  async function load() {
    const p = params();
    history.replaceState({}, '', `/spaces${p.toString() ? `?${p}` : ''}`);
    data = await api(`/api/spaces?${p}`);
  }

  function shell() {
    ctx.main.innerHTML = String(html`
      <section class="page">
        <h1 class="page-title"><span class="wavy">Find a Study Space</span></h1>
        <div class="find">
          <aside class="card filters" aria-label="Filters">
            <h2>Filters</h2>
            ${FILTERS.map(([k, label]) => html`<label class="check"><input type="checkbox" data-kind="${k}" ${raw(st.kinds.has(k) ? 'checked' : '')}><span>${label}</span></label>`)}
            <label class="check"><input type="checkbox" id="f-power" ${raw(st.power ? 'checked' : '')}><span>With Power Outlet</span></label>
            <h2 class="sub">When</h2>
            <div id="when">${whenPicker(st.win)}</div>
          </aside>
          <div class="results">
            <label class="search">${icon.search()}<input type="search" id="q" placeholder="Search by location / block" value="${st.text}" aria-label="Search by location or block"></label>
            <p class="muted small" id="count" aria-live="polite"></p>
            <ul class="space-list" id="list"></ul>
          </div>
        </div>
      </section>`);
    ctx.main.querySelectorAll('[data-kind]').forEach((cb) => cb.addEventListener('change', () => {
      cb.checked ? st.kinds.add(cb.dataset.kind) : st.kinds.delete(cb.dataset.kind); refresh();
    }));
    ctx.main.querySelector('#f-power').addEventListener('change', (e) => { st.power = e.target.checked; refresh(); });
    let t; ctx.main.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.text = e.target.value.trim(); refresh(); }, 250); });
    const bind = () => bindWhen(ctx.main.querySelector('#when'), st.win, (w) => {
      st.win = w; ctx.main.querySelector('#when').innerHTML = String(whenPicker(st.win)); bind(); refresh();
    });
    bind();
  }

  function list() {
    const when = st.win.start ? `${fmtDay(st.win.start)}, ${fmtRange(st.win.start, st.win.start + st.win.dur * 60000)}` : `now, for ${fmtDur(st.win.dur)}`;
    ctx.main.querySelector('#count').textContent = `${data.spaces.length} study space${data.spaces.length === 1 ? '' : 's'} · showing free seats ${when}`;
    ctx.main.querySelector('#list').innerHTML = data.spaces.length ? String(html`${data.spaces.map((s) => html`
      <li><a class="space-row card" href="/spaces/${s.id}${winParams()}" data-link>
        <span class="space-icon">${icon.library()}</span>
        <span class="space-main">
          <b>${s.name}</b> <span class="muted">(${s.area})</span>
          <span class="small muted">${s.block} · ${s.total} ${s.unit}s${s.kinds.includes('quiet') ? ' · Quiet zone' : ''}${s.kinds.includes('group') ? ' · For groups' : ''}</span>
        </span>
        <span class="space-nums">
          <b>${s.free}</b> free${s.unit === 'seat' ? html`<span class="small muted">${icon.bolt(11)} ${s.power_free} with power</span>` : ''}
        </span>
        <span class="badge ${s.status.replace(' ', '-').toLowerCase()}">${s.status}</span>
        <span class="go">${icon.chevron()}</span>
      </a></li>`)}`) : String(html`<li class="empty card">No study space matches these filters. Try removing one.</li>`);
  }

  async function refresh() { await load(); list(); }

  shell();
  await load(); list();
  return { async update() { await load(); list(); } };
}
