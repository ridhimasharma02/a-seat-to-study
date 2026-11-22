// Small UI helpers: safe HTML templates, time formatting, toasts, dialogs and line icons.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

class Html { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Html(String(s));
const val = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(val).join('') : v instanceof Html ? v.s : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return new Html(out);
}

// ---- time ----
let offset = 0;
export const setServerTime = (serverNow) => { offset = serverNow - Date.now(); };
export const now = () => Date.now() + offset;

export const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export function fmtDay(ms) {
  const d = new Date(ms); const t = new Date(now());
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Today';
  const tm = new Date(t); tm.setDate(t.getDate() + 1);
  if (same(d, tm)) return 'Tomorrow';
  return fmtDate(ms);
}
export const fmtRange = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`;
export function fmtLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export function fmtIn(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export const fmtDur = (min) => (min % 60 ? `${Math.floor(min / 60)}½ hours`.replace(/^0/, '') : `${min / 60} hour${min > 60 ? 's' : ''}`);

// ---- toast and dialog ----
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `show ${kind}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = ''; }, 4200);
}

export function dialog(content, { onOpen } = {}) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = String(content);
  dlg.showModal();
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  onOpen?.(dlg);
  return dlg;
}

export const busy = async (btn, fn) => {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Please wait…'; }
  try { return await fn(); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
};

// ---- the "when" picker shared by Spaces and the seat map ----
export const DURATIONS = [60, 90, 120, 150, 180];
export function slotsFor(dayOffset) {
  const base = new Date(now()); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() + dayOffset);
  const out = [];
  for (let m = 6 * 60; m <= 23 * 60 + 30; m += 30) {
    const t = base.getTime() + m * 60000;
    if (t > now() + 5 * 60000) out.push(t);
  }
  return out;
}
export function whenPicker(win) {
  const isNow = !win.start;
  const day = win.start ? (fmtDay(win.start) === 'Tomorrow' ? 1 : 0) : 0;
  const slots = slotsFor(day);
  return html`
    <div class="when" role="group" aria-label="When do you want to study?">
      <label class="field"><span>Date</span>
        <select data-when="day">
          <option value="now" ${raw(isNow ? 'selected' : '')}>Now</option>
          <option value="0" ${raw(!isNow && day === 0 ? 'selected' : '')}>Later today</option>
          <option value="1" ${raw(!isNow && day === 1 ? 'selected' : '')}>Tomorrow</option>
        </select>
      </label>
      <label class="field" ${raw(isNow ? 'hidden' : '')}><span>From</span>
        <select data-when="start">
          ${slots.map((t) => html`<option value="${t}" ${raw(t === win.start ? 'selected' : '')}>${fmtTime(t)}</option>`)}
        </select>
      </label>
      <label class="field"><span>For</span>
        <select data-when="dur">
          ${DURATIONS.map((d) => html`<option value="${d}" ${raw(d === win.dur ? 'selected' : '')}>${fmtDur(d)}</option>`)}
        </select>
      </label>
    </div>`;
}
export function bindWhen(root, win, onChange) {
  const day = root.querySelector('[data-when="day"]');
  const start = root.querySelector('[data-when="start"]');
  const dur = root.querySelector('[data-when="dur"]');
  day.addEventListener('change', () => {
    if (day.value === 'now') onChange({ start: 0, dur: Number(dur.value) });
    else { const s = slotsFor(Number(day.value)); onChange({ start: s[0] || 0, dur: Number(dur.value) }); }
  });
  start.addEventListener('change', () => onChange({ start: Number(start.value), dur: Number(dur.value) }));
  dur.addEventListener('change', () => onChange({ start: win.start, dur: Number(dur.value) }));
}

// ---- line icons drawn in the paper-prototype ink style ----
const svg = (body, size = 24, extra = '') => raw(`<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`);
export const icon = {
  library: (s = 30) => svg('<path d="M3 9.5 12 4l9 5.5"/><path d="M4 10h16"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/><path d="M3.5 20.5h17"/><path d="M4.5 18.5h15"/>', s),
  search: (s = 18) => svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>', s),
  chevron: (s = 18) => svg('<path d="m9 6 6 6-6 6"/>', s),
  bolt: (s = 12) => svg('<path d="M13 3 6 13h5l-1 8 7-10h-5l1-8Z" fill="currentColor" stroke-width="1"/>', s),
  noBolt: (s = 12) => svg('<path d="M13 3 6 13h5l-1 8 7-10h-5l1-8Z" stroke-width="1.4"/><path d="M4 4l16 16" stroke-width="1.8"/>', s),
  calendar: (s = 18) => svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', s),
  clock: (s = 18) => svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', s),
  pin: (s = 18) => svg('<path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>', s),
  seat: (s = 18) => svg('<path d="M7 4h10v8H7z"/><path d="M5 12h14v3H5z"/><path d="M7 15v5M17 15v5"/>', s),
  flag: (s = 18) => svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>', s),
  qr: (s = 18) => svg('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2"/>', s),
  coffee: (s = 18) => svg('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c0 1.5 1 1.5 1 3M11.5 3c0 1.5 1 1.5 1 3"/>', s),
  check: (s = 18) => svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', s),
  users: (s = 18) => svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-2.7-5.3"/>', s),
};

// Big lavender tick used on the "Seat Reserved!" screen, as in the paper prototype.
export const bigCheck = raw(`<svg class="bigcheck" viewBox="0 0 120 100" aria-hidden="true">
  <circle cx="58" cy="54" r="38" fill="#E5DDFB" stroke="#232C63" stroke-width="2.4"/>
  <path d="m40 55 13 13 25-27" fill="none" stroke="#232C63" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M100 18l8-6M104 30h10M98 8l2-7" stroke="#232C63" stroke-width="2.2" stroke-linecap="round"/></svg>`);

// Laptop and books, after the home screen sketch.
export const heroArt = raw(`<svg class="hero-art" viewBox="0 0 360 250" aria-hidden="true">
  <ellipse cx="190" cy="150" rx="160" ry="92" fill="#EEE9FB"/>
  <g fill="none" stroke="#232C63" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M160 70 L285 48 L300 160 L178 182 Z" fill="#FFFFFF"/>
    <path d="M170 78 L278 59 L291 152 L184 171 Z" fill="#F6F3FE"/>
    <path d="M178 182 L300 160 L330 178 L196 205 Z" fill="#FFFFFF"/>
    <path d="M232 186 L262 181"/>
    <path d="M232 104c-6-9-20-4-15 7 3 7 15 14 15 14s12-11 13-19c1-12-12-12-13-2Z" fill="#D9CEF8"/>
    <path d="M40 176 h110 v18 H40 Z" fill="#FFFFFF"/>
    <path d="M48 158 h96 v18 H48 Z" fill="#E3DAFA"/>
    <path d="M36 194 h120 v16 H36 Z" fill="#FFFFFF"/>
    <path d="M52 167h40M44 185h60M42 202h70" stroke-width="1.6"/>
    <path d="M300 40l10-10M312 56h14M292 26l2-12" stroke-width="2"/>
  </g></svg>`);

// ---- password field with show/hide and a Caps Lock warning ----
export function passwordField({ id, label, name, autocomplete }) {
  return html`<div class="field pw-field">
    <label for="${id}">${label}</label>
    <div class="pw-wrap">
      <input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required spellcheck="false" autocapitalize="off">
      <button type="button" class="pw-toggle" data-pw-toggle="${id}" aria-controls="${id}" aria-pressed="false">Show</button>
    </div>
    <p class="caps-warn" data-caps="${id}" hidden>Caps Lock is on</p>
  </div>`;
}
export function bindPasswordFields(root) {
  root.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
    const input = root.querySelector(`#${btn.dataset.pwToggle}`);
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
      input.focus();
    });
    const caps = root.querySelector(`[data-caps="${btn.dataset.pwToggle}"]`);
    const check = (e) => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
    input.addEventListener('keydown', check);
    input.addEventListener('keyup', check);
    input.addEventListener('blur', () => { caps.hidden = true; });
  });
}
