// Connect to Supabase: paste the connection string and your database password.
// The server only accepts this from the computer it runs on, and only until Supabase is set up.
import { api, post } from '../api.js';
import { html, busy, passwordField, bindPasswordFields } from '../ui.js';

export async function render(ctx) {
  let info;
  try { info = await api('/api/setup/supabase'); }
  catch (e) {
    ctx.main.innerHTML = String(html`<section class="page narrow"><div class="card"><h1 class="page-title">Connect to Supabase</h1><p class="error">${e.message}</p></div></section>`);
    return;
  }
  if (info.configured) {
    ctx.main.innerHTML = String(html`<section class="page narrow"><div class="card">
      <h1 class="page-title"><span class="wavy">Connected to Supabase</span></h1>
      <p>The connection to <b>${info.host}</b> is saved.</p>
      <p class="note">${info.in_use ? html`The app is using Supabase right now.` : html`Restart the app to start using it. The first start creates the tables in Supabase.`}</p>
    </div></section>`);
    return;
  }
  ctx.main.innerHTML = String(html`
    <section class="page narrow">
      <form class="card form" id="sb" novalidate>
        <h1 class="page-title"><span class="wavy">Connect to Supabase</span></h1>
        <p class="muted">Right now the app keeps its data in ${info.using}. Connect it to your Supabase project here.</p>
        <label class="field"><span>Connection string (Supabase → Connect → Direct → Session pooler)</span>
          <input id="sb-url" name="supabase_url" autocomplete="off" spellcheck="false" value="${info.template}"
            placeholder="postgresql://postgres.xxxx:[YOUR-DATABASE-PASSWORD]@aws-….pooler.supabase.com:5432/postgres"></label>
        ${passwordField({ id: 'sb-pw', label: 'Database password (the one you set when you created the Supabase project)', name: 'supabase_db_password', autocomplete: 'off' })}
        <p class="error" id="sb-err" role="alert"></p>
        <button class="btn primary wide big" type="submit" id="sb-go">Test and save</button>
        <p class="small muted">The password stays on this computer: it's saved in the app's private <code>.env</code> file, which is never uploaded to GitHub. This page only works on the computer running the app.</p>
      </form>
      <div id="sb-ok"></div>
    </section>`);
  bindPasswordFields(ctx.main);
  ctx.main.querySelector(info.template ? '#sb-pw' : '#sb-url').focus();
  ctx.main.querySelector('#sb').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = ctx.main.querySelector('#sb-err');
    err.textContent = '';
    busy(ctx.main.querySelector('#sb-go'), async () => {
      try {
        const r = await post('/api/setup/supabase', { url: ctx.main.querySelector('#sb-url').value, password: ctx.main.querySelector('#sb-pw').value });
        ctx.main.querySelector('#sb').remove();
        ctx.main.querySelector('#sb-ok').innerHTML = String(html`<div class="card">
          <h1 class="page-title"><span class="wavy">Connected!</span></h1>
          <p>${r.version} at <b>${r.host}</b>.</p>
          <p class="note">The connection is saved. Restart the app to switch to Supabase: the first start creates the tables there and loads the demo data.</p></div>`);
      } catch (e2) { err.textContent = e2.message; }
    });
  });
}
