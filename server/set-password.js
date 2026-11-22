// Set a new password for any account (staff or student), from the terminal.
//   npm run set-password -- LIB001
//   npm run set-password -- 12345678
// The password is typed privately (nothing shows on screen) and that account's other logins are signed out.
// Uses Supabase when .env has DATABASE_URL, otherwise the local database.
import { join } from 'node:path';
import { openStore } from './store.js';
import { hashPassword } from './auth.js';
import { ask, done } from './prompt.js';

const ROOT = join(import.meta.dirname, '..');
const id = String(process.argv[2] || '').trim();
if (!id) {
  console.log('Usage: npm run set-password -- <Staff ID or registration number>\n  e.g. npm run set-password -- LIB001');
  process.exit(1);
}

const db = await openStore({ url: process.env.DATABASE_URL, file: process.env.DB_FILE || join(ROOT, 'data', 'seat-to-study.db') });
const user = (await db.get('SELECT id, reg_no, name, role FROM users WHERE reg_no = ? AND is_demo = 0', id.toUpperCase()))
  || (await db.get('SELECT id, reg_no, name, role FROM users WHERE reg_no = ? AND is_demo = 0', id));
if (!user) {
  const staff = (await db.all("SELECT reg_no FROM users WHERE role = 'staff' ORDER BY reg_no")).map((r) => r.reg_no).join(', ');
  console.log(`No account with the ID "${id}" in the ${db.where}. Staff IDs here: ${staff || 'none yet (start the app once first)'}`);
  process.exit(1);
}

console.log(`Setting a new password for ${user.name} (${user.role === 'staff' ? 'Staff ID' : 'Reg. no.'} ${user.reg_no}) in the ${db.where}.`);
const first = await ask('New password (at least 6 characters, shown as dots): ');
if (first.length < 6) { console.log('Too short. Nothing was changed.'); process.exit(1); }
if (first !== first.trim()) { console.log("A password can't start or end with a space. Nothing was changed."); process.exit(1); }
const again = await ask('Type it again: ');
done();
if (again !== first) { console.log("The two passwords don't match. Nothing was changed."); process.exit(1); }

await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(first), user.id);
await db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
await db.close();
console.log(`Done. ${user.reg_no} can now log in with the new password${user.role === 'staff' ? ' at /staff/login' : ' at /login'}.`);
process.exit(0);
