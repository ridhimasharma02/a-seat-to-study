// App shell: login wall, header, routing between pages, live updates.
import { api, post } from './api.js';
import { html, raw, esc, setServerTime, toast, dialog, busy, passwordField, bindPasswordFields } from './ui.js';

const PAGES = [
  [/^\/$/, 'home'],
  [/^\/spaces$/, 'spaces'],
  [/^\/spaces\/([\w-]+)$/, 'space'],
  [/^\/bookings$/, 'bookings'],
  [/^\/report$/, 'report'],
  [/^\/insights$/, 'insights'],
  [/^\/staff\/login$/, 'stafflogin'],
  [/^\/staff(?:\/(seats|sockets|stickers))?$/, 'staff'],
  [/^\/login$/, 'login'],
  [/^\/register$/, 'register'],
  [/^\/checkin$/, 'checkin'],
  [/^\/setup$/, 'setup'],
];
const OPEN_PAGES = new Set(['login', 'register', 'stafflogin']); // the only pages you can see before logging in
const STAFF_PAGES = new Set(['staff']);                            // staff portal: staff accounts only
const NAV = [['/', 'Home'], ['/spaces', 'Spaces'], ['/bookings', 'My Bookings'], ['/report', 'Report']];
const STAFF_NAV = [['/staff', 'Reports'], ['/staff/seats', 'Seats in use'], ['/staff/sockets', 'Sockets'], ['/staff/stickers', 'Desk stickers']];
const homeOf = (u) => (u?.role === 'staff' ? '/staff' : '/');

const state = { me: null, page: null, rules: null, live: 'stream' };
const main = document.getElementById('app');

const brand = raw(`<a class="brand" href="/" data-link>
  <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v8H7z"/><path d="M5 12h14v3H5z"/><path d="M7 15v5M17 15v5"/></svg></span>
  A Seat to Study</a>`);

function header() {
  const path = location.pathname;
  const active = (href) => (href === '/' ? path === '/' : path.startsWith(href));
  const bar = document.getElementById('topbar');
  const staffSide = state.me ? state.me.role === 'staff' : path.startsWith('/staff');
  document.body.classList.toggle('staff-mode', staffSide);
  if (!state.me) {
    // before logging in there is nowhere else to go
    bar.innerHTML = String(staffSide
      ? html`<div class="bar">${brand}<span class="portal-pill">Staff portal</span><div class="account"><a href="/login" data-link class="ghost-link">Student login</a></div></div>`
      : html`<div class="bar">${brand}<div class="account">
          ${path === '/register' ? html`<a href="/login" data-link class="btn small">Log in</a>` : html`<a href="/register" data-link class="btn small">Create an account</a>`}
        </div></div>`);
    return;
  }
  if (state.me.role === 'staff') {
    const onStaff = (href) => (href === '/staff' ? path === '/staff' : path === href);
    bar.innerHTML = String(html`
      <div class="bar">
        ${brand}<span class="portal-pill">Staff portal</span>
        <nav class="nav" aria-label="Staff">
          ${STAFF_NAV.map(([href, label]) => html`<a href="${href}" data-link class="${onStaff(href) ? 'on' : ''}" ${raw(onStaff(href) ? 'aria-current="page"' : '')}>${label}${href === '/staff' && state.openReports ? html` <span class="count">${state.openReports}</span>` : ''}</a>`)}
        </nav>
        <div class="account">
          <details class="who"><summary>${state.me.name}</summary>
            <div class="menu"><p><b>${state.me.name}</b><br><span class="muted">${state.me.title || 'Library staff'}<br>Staff ID ${state.me.staff_id}</span></p>
            <button type="button" class="btn small wide" id="change-pw">Change password</button>
            <button type="button" class="btn small wide" id="logout">Log out</button></div></details>
        </div>
      </div>`);
    document.getElementById('logout').addEventListener('click', logout);
    document.getElementById('change-pw').addEventListener('click', changePassword);
    return;
  }
  bar.innerHTML = String(html`
    <div class="bar">
      ${brand}
      <nav class="nav" aria-label="Main">
        ${NAV.map(([href, label]) => html`<a href="${href}" data-link class="${active(href) ? 'on' : ''}" ${raw(active(href) ? 'aria-current="page"' : '')}>${label}</a>`)}
      </nav>
      <div class="account">
        <a href="/insights" data-link class="ghost-link ${active('/insights') ? 'on' : ''}">Insights</a>
        <details class="who"><summary>${state.me.name.split(' ')[0]}</summary>
          <div class="menu"><p><b>${state.me.name}</b><br><span class="muted">Reg. no. ${state.me.reg_no}</span></p>
          <button type="button" class="btn small wide" id="change-pw">Change password</button>
          <button type="button" class="btn small wide" id="logout">Log out</button></div></details>
      </div>
    </div>`);
  document.getElementById('logout').addEventListener('click', logout);
  document.getElementById('change-pw').addEventListener('click', changePassword);
}

function changePassword() {
  document.querySelector('details.who')?.removeAttribute('open');
  const section = state.me.role === 'staff' ? 'section-staff' : 'section-student';
  const dlg = dialog(html`
    <form class="dlg-body" id="pw-form" novalidate>
      <h2>Change your password</h2>
      <p class="small muted">${state.me.role === 'staff' ? `Staff ID ${state.me.staff_id}` : `Reg. no. ${state.me.reg_no}`}. Your other devices will be logged out.</p>
      ${passwordField({ id: 'cp-cur', label: 'Current password', name: 'current_password', autocomplete: `${section} current-password` })}
      ${passwordField({ id: 'cp-new', label: 'New password (at least 8 characters)', name: 'new_password', autocomplete: `${section} new-password` })}
      ${passwordField({ id: 'cp-new2', label: 'New password again', name: 'new_password_again', autocomplete: `${section} new-password` })}
      <p class="error" id="cp-err" role="alert"></p>
      <div class="dlg-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary" id="cp-go">Change password</button>
      </div>
    </form>`, { onOpen: (d) => { bindPasswordFields(d); d.querySelector('#cp-cur').focus(); } });
  dlg.querySelector('#pw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = dlg.querySelector('#cp-err');
    const current = dlg.querySelector('#cp-cur').value, next = dlg.querySelector('#cp-new').value, again = dlg.querySelector('#cp-new2').value;
    if (!current || !next) { err.textContent = 'Please fill in every field.'; return; }
    if (next.length < 8) { err.textContent = 'The new password needs at least 8 characters.'; return; }
    if (next !== again) { err.textContent = "The two new passwords don't match."; return; }
    busy(dlg.querySelector('#cp-go'), async () => {
      try { await post('/api/password', { current, next }); dlg.close(); toast('Password changed.'); }
      catch (e2) { err.textContent = e2.message; }
    });
  });
}

async function logout() {
  const wasStaff = state.me?.role === 'staff';
  await post('/api/logout');
  setMe(null);
  toast('You are logged out.');
  navigate(wasStaff ? '/staff/login' : '/login', { replace: true });
}

// The staff header shows how many reports are waiting.
export function setOpenReports(n) { state.openReports = n; if (state.me?.role === 'staff') header(); }

function setMe(user) {
  state.me = user;
  if (user) connect(); else disconnect();
  header();
}

export function navigate(to, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', to); else history.pushState({}, '', to);
  render();
}

async function render() {
  state.page?.destroy?.();
  state.page = null;
  const path = location.pathname;
  const hit = PAGES.find(([re]) => re.test(path));
  const name = hit?.[1];

  // Login wall: the login page comes first; nothing else opens until you are logged in.
  // (The Supabase setup page is the exception: it is needed before anyone can log in, and the server only allows it locally.)
  if (name === 'setup') { /* always allowed */ }
  else if (!state.me && !OPEN_PAGES.has(name)) {
    const staffSide = path.startsWith('/staff');
    const next = path === '/' || path === '/staff' || !hit ? '' : `?next=${encodeURIComponent(path + location.search)}`;
    history.replaceState({}, '', `${staffSide ? '/staff/login' : '/login'}${next}`);
    return render();
  }
  else if (state.me) {
    const isStaff = state.me.role === 'staff';
    // logged in already: the login pages send you to your own home
    if (OPEN_PAGES.has(name)) { history.replaceState({}, '', homeOf(state.me)); return render(); }
    // staff can't use the student part, and students can't open the staff portal
    if (hit && isStaff !== STAFF_PAGES.has(name)) {
      toast(isStaff ? 'Staff accounts use the staff portal only.' : 'The staff portal is only for library staff.', 'error');
      history.replaceState({}, '', homeOf(state.me));
      return render();
    }
  }

  header();
  document.body.classList.toggle('signed-out', !state.me);
  if (!hit) { main.innerHTML = `<section class="page narrow"><h1>Page not found</h1><p><a href="${homeOf(state.me)}" data-link>Go home</a></p></section>`; return; }
  const params = path.match(hit[0]).slice(1);
  const mod = await import(`./pages/${name === 'register' ? 'login' : name}.js`);
  main.innerHTML = '<div class="loading" aria-busy="true">Loading…</div>';
  const ctx = {
    main, params, query: new URLSearchParams(location.search), me: state.me, rules: state.rules, navigate,
    setMe: (u) => { setMe(u); ctx.me = u; },
  };
  try {
    state.page = (await mod.render(ctx, name)) || null;
  } catch (e) {
    if (e.status === 401) return; // session ended: the auth-lost handler below sends you to the login page
    main.innerHTML = String(html`<section class="page narrow"><h1>Something went wrong</h1><p>${e.message}</p><p><a href="/" data-link>Go home</a></p></section>`);
  }
  const h1 = document.querySelector('#app h1')?.textContent.trim();
  document.title = h1 && h1 !== 'A Seat to Study' ? `${h1} · A Seat to Study` : 'A Seat to Study · LPU';
  if (!location.hash) window.scrollTo(0, 0);
}

// Internal links without a full page load.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  e.preventDefault();
  document.querySelector('details.who')?.removeAttribute('open');
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

// If the server says the session is gone (expired, or logged out in another tab), go back to the login page.
window.addEventListener('auth-lost', () => {
  if (!state.me) return;
  setMe(null);
  toast('Please log in again.', 'error');
  navigate(`${location.pathname.startsWith('/staff') ? '/staff/login' : '/login'}?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
});

// Live updates: the server pushes which spaces changed, the open page refreshes itself.
// On Vercel (no long-lived connections) the open page refreshes itself every 10 seconds instead.
let es = null, poll = null, pending = new Set(), timer = null;
const EVERYTHING = { has: () => true };
function connect() {
  if (state.live === 'poll') {
    if (!poll) poll = setInterval(() => { if (!document.hidden) Promise.resolve(state.page?.update?.(EVERYTHING)).catch(() => {}); }, 10_000);
    return;
  }
  if (es) return;
  es = new EventSource('/api/stream');
  es.addEventListener('update', (ev) => {
    for (const id of JSON.parse(ev.data).spaces) pending.add(id);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const ids = pending; pending = new Set();
      Promise.resolve(state.page?.update?.(ids)).catch(() => {});
    }, 400);
  });
  es.onopen = () => document.body.classList.remove('offline');
  es.onerror = () => { if (es) document.body.classList.add('offline'); };
}
function disconnect() {
  es?.close(); es = null;
  clearInterval(poll); poll = null;
  document.body.classList.remove('offline');
}

(async function start() {
  let meta, me;
  try {
    [meta, me] = await Promise.all([api('/api/meta'), api('/api/me')]);
  } catch (e) {
    // Never leave people staring at "Loading…": say what is wrong.
    const noServer = e.status === 404;
    main.innerHTML = `<section class="page narrow"><div class="card">
      <h1 class="page-title">Can't reach the app's server</h1>
      <p>${noServer ? "This address only has the website files: the app's server part isn't running here." : esc(e.message)}</p>
      <p class="muted small">${noServer
        ? 'On Vercel, check that the project was deployed from the repository root, with its <code>api/</code> folder and <code>vercel.json</code>.'
        : 'If this is on Vercel, check Settings &gt; Environment Variables &gt; DATABASE_URL, then redeploy.'}</p>
    </div></section>`;
    return;
  }
  setServerTime(meta.now);
  state.rules = meta.rules;
  state.live = meta.live || 'stream';
  state.me = me.user;
  if (state.me) connect();
  await render();
})();
