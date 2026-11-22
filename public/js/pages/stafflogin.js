// Staff login: a separate page for library staff. Student accounts are refused here.
import { post } from '../api.js';
import { html, icon, toast, busy, passwordField, bindPasswordFields } from '../ui.js';

export async function render(ctx) {
  const nextParam = ctx.query.get('next');
  const next = nextParam && nextParam.startsWith('/staff') && !nextParam.startsWith('//') ? nextParam : '/staff';
  ctx.main.innerHTML = String(html`
    <section class="page welcome staff-welcome">
      <div class="welcome-text">
        <p class="eyebrow">Library staff</p>
        <h1 class="display">Staff portal</h1>
        <p class="lead">For librarians, reading-hall attendants and maintenance staff who look after the study spaces.</p>
        <ul class="welcome-points">
          <li>Handle seat reports from students: free seats held by bags, check noise</li>
          <li>See who is using every seat, and who is on a break</li>
          <li>Keep track of power sockets that don't work</li>
          <li>Print the QR stickers for each desk</li>
        </ul>
      </div>
      <form class="card form auth staff-auth" id="auth" novalidate>
        <div class="auth-band">${icon.flag(18)} Staff portal · A Seat to Study</div>
        <h2 class="auth-title">Staff log in</h2>
        <p class="muted">Use the Staff ID given to you by the library.</p>
        ${nextParam ? html`<p class="note small">Please log in to open that staff page.</p>` : ''}
        <label class="field"><span>Staff ID</span><input id="s-id" name="staff_id" autocomplete="section-staff username" autocapitalize="characters" spellcheck="false" required placeholder="e.g. LIB001"></label>
        ${passwordField({ id: 's-pw', label: 'Password', name: 'staff_password', autocomplete: 'section-staff current-password' })}
        <p class="error" id="s-err" role="alert"></p>
        <button class="btn primary wide big" type="submit" id="s-go">Log in to the staff portal</button>
        <p class="center small swap">Are you a student? <a href="/login" data-link>Go to the student login</a></p>
        <p class="center small muted">Forgot your password? Ask the library office to reset it. Once logged in, you can change it from your name in the top bar.</p>
      </form>
    </section>`);
  bindPasswordFields(ctx.main);
  ctx.main.querySelector('#s-id').focus();
  ctx.main.querySelector('#auth').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = ctx.main.querySelector('#s-err');
    const body = { staff_id: ctx.main.querySelector('#s-id').value.trim(), password: ctx.main.querySelector('#s-pw').value };
    if (!body.staff_id || !body.password) { err.textContent = 'Please enter your Staff ID and password.'; return; }
    if (/^\d+$/.test(body.staff_id)) { err.innerHTML = 'That looks like a student registration number. Staff IDs look like <b>LIB001</b>. Students log in on the <a href="/login" data-link>student login page</a>.'; return; }
    busy(ctx.main.querySelector('#s-go'), async () => {
      try {
        const r = await post('/api/staff/login', body);
        ctx.setMe(r.user);
        toast(`Hi ${r.user.name}.`);
        ctx.navigate(next, { replace: true });
      } catch (e2) { err.textContent = e2.message; }
    });
  });
}
