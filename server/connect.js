// Connect A Seat to Study to your Supabase project.
//   npm run connect-supabase
// Paste the connection string from Supabase (it contains your database password; nothing shows while you paste).
// It is tested, then saved to .env, which Git ignores, so it never reaches GitHub.
import { writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { ask, done } from './prompt.js';

const ENV = join(import.meta.dirname, '..', '.env');

console.log(`
Connect A Seat to Study to Supabase
-----------------------------------
In your Supabase project: click "Connect" > "Direct (Connection string)" > "Session pooler", and copy the string
(it starts with postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres).
You can paste it exactly as it is: you'll be asked for the password next.
`);

// The connection string can also be given on the command line: npm run connect-supabase -- "postgresql://..."
let url = String(process.argv[2] || '').trim();
if (url) console.log(`Using the connection string: ${url.replace(/:([^:@/]+)@/, (m, p) => (/^\[.*\]$/.test(p) ? m : ':****@'))}`);
else url = (await ask('1) Paste the connection string (it shows as dots), then press Enter: ')).trim();
if (!url) { done(); console.log('Nothing pasted. Nothing was changed.'); process.exit(1); }
// Supabase writes the password as a placeholder, e.g. [YOUR-PASSWORD] or [YOUR-DATABASE-PASSWORD]
const placeholder = url.match(/\[YOUR[-_ A-Z]*PASSWORD\]/i);
if (placeholder) {
  const pw = await ask('Now paste your database password (it shows as dots), then press Enter: ');
  if (!pw) { done(); console.log('No password given. Nothing was changed.'); process.exit(1); }
  url = url.replace(placeholder[0], encodeURIComponent(pw));
}
done();
// Passwords with characters like @ # / ? must be encoded inside a URL; do that for the user.
const m = url.match(/^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@]+)$/);
if (m) {
  let pw = m[3];
  try { pw = decodeURIComponent(pw); } catch { /* already plain */ }
  url = `${m[1]}${m[2]}:${encodeURIComponent(pw)}@${m[4]}`;
}
let parsed;
try { parsed = new URL(url); } catch { console.log("That doesn't look like a connection string. It should start with postgresql://"); process.exit(1); }
if (!/^postgres(ql)?:$/.test(parsed.protocol)) { console.log('It should start with postgresql://'); process.exit(1); }

console.log(`Testing the connection to ${parsed.hostname}…`);
try {
  const { openStore } = await import('./store.js');
  const db = await openStore({ url });
  const v = await db.get('SELECT version() AS v');
  await db.close();
  console.log(`Connected: ${String(v.v).split(',')[0]}`);
} catch (e) {
  console.log(`Could not connect: ${e.message}`);
  if (/password authentication/i.test(e.message)) console.log('The database password is wrong. You can reset it in Supabase under Project Settings > Database.');
  if (/ENOTFOUND|getaddrinfo/i.test(e.message)) console.log('The address was not found. Use the "Session pooler" string; the "Direct connection" one needs IPv6.');
  console.log('Nothing was changed.');
  process.exit(1);
}

// Keep any other settings already in .env, replace DATABASE_URL.
const keep = existsSync(ENV) ? readFileSync(ENV, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('DATABASE_URL=')) : [];
writeFileSync(ENV, [...keep, `DATABASE_URL="${url}"`, ''].join('\n'));
chmodSync(ENV, 0o600);
console.log(`
Saved to .env (Git ignores this file, so your password stays on this computer).
Start the app with:  npm start
The first start creates the tables in Supabase and fills them with the demo data (this takes a few seconds).
To go back to the local database, delete the .env file.
`);
process.exit(0);
