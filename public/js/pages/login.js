// The first page everyone sees: log in or create an account. After that you land on Home.
import { post } from '../api.js';
import { html, raw, toast, busy, heroArt, passwordField, bindPasswordFields } from '../ui.js';

export async function render(ctx, name) {
  const isRegister = name === 'register';
  const nextParam = ctx.query.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const swap = `${isRegister ? '/login' : '/register'}${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ''}`;
  ctx.main.innerHTML = String(html`
    <section class="page welcome">
      <div class="welcome-text">
        <h1 class="display"><span class="wavy">A Seat to Study</span></h1>
        <p class="lead">Find and reserve study spaces in LPU.</p>
        <ul class="welcome-points">
          <li>See free seats in every study space before you leave the hostel</li>
          <li>Reserve a seat on the floor plan or in 3D</li>
          <li>Check in with the QR sticker on your desk</li>
        </ul>
        ${heroArt}
      </div>
      <form class="card form auth" id="auth" novalidate>
        <h2 class="auth-title">${isRegister ? 'Create an account' : 'Log in'}</h2>
        <p class="muted">${isRegister ? 'Use your LPU registration number so the library knows who has each seat.' : 'Log in with your registration number to continue.'}</p>
        ${nextParam ? html`<p class="note small">Please log in to open that page.</p>` : ''}
        ${isRegister ? html`<label class="field"><span>Full name</span><input id="a-name" name="name" autocomplete="section-student name" required maxlength="60"></label>` : ''}
        <label class="field"><span>Registration number</span>
          <input id="a-reg" name="reg_no" autocomplete="section-student username" inputmode="numeric" required></label>
        ${passwordField({ id: 'a-pw', label: isRegister ? 'Password (at least 6 characters)' : 'Password', name: 'student_password', autocomplete: isRegister ? 'section-student new-password' : 'section-student current-password' })}
        <p class="error" id="a-err" role="alert"></p>
        <button class="btn primary wide big" type="submit" id="a-go">${isRegister ? 'Create account' : 'Log in'}</button>
        <p class="center small swap">${isRegister ? 'Already have an account?' : 'New here?'} <a href="${swap}" data-link>${isRegister ? 'Log in' : 'Create an account'}</a></p>
        <p class="center small staff-link">Library staff? <a href="/staff/login" data-link>Use the staff login</a></p>
      </form>
    </section>`);
  bindPasswordFields(ctx.main);
  ctx.main.querySelector(isRegister ? '#a-name' : '#a-reg').focus();
  ctx.main.querySelector('#auth').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = ctx.main.querySelector('#a-err');
    const body = { reg_no: ctx.main.querySelector('#a-reg').value.trim(), password: ctx.main.querySelector('#a-pw').value };
    if (isRegister) body.name = ctx.main.querySelector('#a-name').value.trim();
    if ((isRegister && !body.name) || !body.reg_no || !body.password) { err.textContent = 'Please fill in every field.'; return; }
    if (!isRegister && /^[A-Za-z]{2,}\d+$/.test(body.reg_no)) { err.innerHTML = 'That looks like a Staff ID. Library staff log in on the <a href="/staff/login" data-link>staff login page</a>.'; return; }
    busy(ctx.main.querySelector('#a-go'), async () => {
      try {
        const r = await post(isRegister ? '/api/register' : '/api/login', body);
        ctx.setMe(r.user);
        toast(isRegister ? `Welcome, ${r.user.name.split(' ')[0]}!` : `Hi ${r.user.name.split(' ')[0]}.`);
        ctx.navigate(next, { replace: true });
      } catch (e2) { err.textContent = e2.message; }
    });
  });
}
