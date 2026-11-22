// Insights: how full each space is now, and its usual busy times.
import { api } from '../api.js';
import { html, raw } from '../ui.js';

const hourName = (h) => (h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`);

function chart(hourly, nowHour) {
  const W = 1000, H = 230, left = 48, right = 12, base = H - 30, top = 14;
  const bw = (W - left - right) / hourly.length;
  const yOf = (pct) => base - (pct / 100) * (base - top);
  const grid = [0, 25, 50, 75, 100].map((p) => `<line x1="${left}" x2="${W - right}" y1="${yOf(p)}" y2="${yOf(p)}" class="${p ? 'grid' : 'grid base'}"/><text x="${left - 8}" y="${yOf(p) + 4}" class="axis end">${p}%</text>`).join('');
  const bars = hourly.map((d, i) => {
    const x = left + i * bw + 8, w = bw - 16, y = yOf(d.pct);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(base - y).toFixed(1)}" rx="4" class="${d.hour === nowHour ? 'cbar now' : 'cbar'}"><title>${hourName(d.hour)}: about ${d.pct}% full</title></rect>`
      + `<text x="${(x + w / 2).toFixed(1)}" y="${H - 9}" class="axis">${hourName(d.hour)}</text>`;
  }).join('');
  return raw(`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Usual occupancy by hour, 8 am to 10 pm">${grid}${bars}</svg>`);
}

export async function render(ctx) {
  let data;
  let picked = ctx.query.get('space');
  async function load() { data = await api('/api/insights'); if (!picked) picked = data.spaces[0].id; }
  function draw() {
    const nowHour = new Date().getHours();
    const sp = data.spaces.find((s) => s.id === picked) || data.spaces[0];
    ctx.main.innerHTML = String(html`
      <section class="page">
        <h1 class="page-title"><span class="wavy">Library Insights</span></h1>
        <p class="muted">Plan when to go. The busy times are averaged over the last ${data.based_on_days} days of bookings in this prototype's demo data.</p>
        <div class="card">
          <div class="card-head"><h2>How full is it right now?</h2><span class="muted small">Updates live</span></div>
          <ul class="occ-list">${data.spaces.map((s) => html`
            <li><button type="button" class="occ ${s.id === picked ? 'on' : ''}" data-space="${s.id}">
              <span><b>${s.name}</b> <span class="muted">(${s.area})</span></span>
              <span class="fl-bar" aria-hidden="true"><i style="width:${s.pct_now}%"></i></span>
              <span class="fl-num">${s.pct_now}% full · ${s.free} free</span>
            </button></li>`)}</ul>
        </div>
        <div class="card">
          <div class="card-head"><h2>Usual busy times: ${sp.name} <span class="muted">(${sp.area})</span></h2></div>
          ${chart(sp.hourly, nowHour)}
          <p class="tip">Quietest: <b>around ${hourName(sp.quietest.hour)}</b> (about ${sp.quietest.pct}% full). Busiest: <b>around ${hourName(sp.busiest.hour)}</b> (about ${sp.busiest.pct}% full).</p>
        </div>
      </section>`);
    ctx.main.querySelectorAll('[data-space]').forEach((b) => b.addEventListener('click', () => {
      picked = b.dataset.space; history.replaceState({}, '', `/insights?space=${picked}`); draw();
    }));
  }
  await load(); draw();
  return { async update() { await load(); draw(); } };
}
