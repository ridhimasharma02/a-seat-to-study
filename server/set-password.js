// Set a new password for any account (staff or student), from the terminal.
//   npm run set-password -- LIB001
//   npm run set-password -- 12345678
// The password is typed privately (nothing shows on screen) and that account's other logins are signed out.
import { join } from 'node:path';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const ROOT = join(import.meta.dirname, '..');
const id = String(process.argv[2] || '').trim();
if (!id) {
  console.log('Usage: npm run set-password -- <Staff ID or registration number>\n  e.g. npm run set-password -- LIB001');
  process.exit(1);
}

const db = openDb(process.env.DB_FILE || join(ROOT, 'data', 'seat-to-study.db'));
const user = db.q('SELECT id, reg_no, name, role FROM users WHERE reg_no = ? AND is_demo = 0').get(id.toUpperCase())
  || db.q('SELECT id, reg_no, name, role FROM users WHERE reg_no = ? AND is_demo = 0').get(id);
if (!user) {
  const staff = db.q("SELECT reg_no FROM users WHERE role = 'staff' ORDER BY reg_no").all().map((r) => r.reg_no).join(', ');
  console.log(`No account with the ID "${id}". Staff IDs here: ${staff}`);
  process.exit(1);
}

// Read lines from the keyboard without showing what is typed.
let buffer = '', listening = false;
const waiting = [];
function drain() {
  while (waiting.length) {
    const i = buffer.search(/[\r\n]/);
    if (i < 0) return;
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1).replace(/^\n/, '');
    process.stdout.write('\n');
    waiting.shift()(line);
  }
}
function askHidden(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    waiting.push(resolve);
    if (!listening) {
      listening = true;
      process.stdin.setRawMode?.(true);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        for (const c of chunk) {
          if (c === '\u0003') { process.stdin.setRawMode?.(false); process.stdout.write('\nCancelled. Nothing was changed.\n'); process.exit(1); } // Ctrl-C
          if (c === '\u007f' || c === '\b') buffer = buffer.slice(0, -1);                                                                     // Backspace
          else buffer += c;
        }
        drain();
      });
      process.stdin.resume();
    }
    drain();
  });
}

console.log(`Setting a new password for ${user.name} (${user.role === 'staff' ? 'Staff ID' : 'Reg. no.'} ${user.reg_no}).`);
const first = await askHidden('New password (at least 6 characters, nothing shows while you type): ');
if (first.length < 6) { console.log('Too short. Nothing was changed.'); process.exit(1); }
if (first !== first.trim()) { console.log("A password can't start or end with a space. Nothing was changed."); process.exit(1); }
const again = await askHidden('Type it again: ');
if (again !== first) { console.log("The two passwords don't match. Nothing was changed."); process.exit(1); }

db.q('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(first), user.id);
db.q('DELETE FROM sessions WHERE user_id = ?').run(user.id);
console.log(`Done. ${user.reg_no} can now log in with the new password${user.role === 'staff' ? ' at /staff/login' : ' at /login'}.`);
process.exit(0);
