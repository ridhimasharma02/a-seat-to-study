// Check the Supabase connection saved in .env, without asking anything.
//   npm run check-supabase
// Fixes the password encoding if needed (characters like @ # / ?) and tests the connection.
// The password itself is never printed.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

import { rmSync } from 'node:fs';
const ROOT = join(import.meta.dirname, '..');
const ENV = join(ROOT, '.env');
// Optionally read the connection from another file (e.g. supabase-password.txt); on success it moves into .env.
const SOURCE = process.argv[2] ? join(ROOT, process.argv[2]) : ENV;
if (!existsSync(SOURCE)) { console.log(`No ${SOURCE === ENV ? '.env' : process.argv[2]} file yet.`); process.exit(1); }
const lines = readFileSync(SOURCE, 'utf8').split(/\r?\n/);
const i = lines.findIndex((l) => l.trim().startsWith('DATABASE_URL='));
if (i < 0) { console.log('.env has no DATABASE_URL line.'); process.exit(1); }
let url = lines[i].trim().slice('DATABASE_URL='.length).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
if (/PASTE-PASSWORD-HERE|\[YOUR[-_ A-Z]*PASSWORD\]/i.test(url)) {
  console.log('The password is not in .env yet: replace PASTE-PASSWORD-HERE with your database password, save the file, and run this again.');
  process.exit(1);
}
const m = url.match(/^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@]+)$/);
if (!m) { console.log("The DATABASE_URL line doesn't look like a Supabase connection string."); process.exit(1); }
let pw = m[3].trim();
try { pw = decodeURIComponent(pw); } catch { /* plain */ }
url = `${m[1]}${m[2]}:${encodeURIComponent(pw)}@${m[4].trim()}`;
const host = new URL(url).hostname;

console.log(`Testing the connection to ${host} (password length ${pw.length})…`);
try {
  const { openStore } = await import('./store.js');
  const db = await openStore({ url });
  const v = await db.get('SELECT version() AS v');
  await db.close();
  const keep = existsSync(ENV) ? readFileSync(ENV, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('DATABASE_URL=') && !l.startsWith('#')) : [];
  writeFileSync(ENV, [...keep, `DATABASE_URL="${url}"`, ''].join('\n'));
  chmodSync(ENV, 0o600);
  if (SOURCE !== ENV) { rmSync(SOURCE); console.log(`Moved the connection into .env and deleted ${process.argv[2]}.`); }
  console.log(`Connected: ${String(v.v).split(',')[0]}`);
  console.log('Saved. Start the app with `npm start`; the first start creates the tables in Supabase.');
} catch (e) {
  console.log(`Could not connect: ${e.message}`);
  if (/password authentication/i.test(e.message)) console.log('The password is wrong. Reset it in Supabase (Project Settings > Database > Reset database password) and put the new one in .env.');
  if (/ENOTFOUND|getaddrinfo/i.test(e.message)) console.log('The address was not found. Use the "Session pooler" connection string.');
  if (/Tenant or user not found/i.test(e.message)) console.log('Supabase does not recognise the project in this string. Copy the Session pooler string again.');
  process.exit(1);
}
process.exit(0);
