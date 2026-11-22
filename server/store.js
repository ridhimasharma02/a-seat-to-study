// One database API for two databases:
//   - Supabase (Postgres), when DATABASE_URL is set (see `npm run connect-supabase`)
//   - a local SQLite file otherwise, so the app still runs offline
// Queries are written once with ? placeholders; every call is async.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function openStore({ url, file }) {
  return url ? openPostgres(url) : openSqlite(file);
}

async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite'); // only loaded when the local database is used
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const cache = new Map();
  const st = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  const ops = {
    get: async (sql, ...p) => st(sql).get(...p) ?? null,
    all: async (sql, ...p) => st(sql).all(...p),
    run: async (sql, ...p) => {
      if (/\breturning\b/i.test(sql)) { const rows = st(sql).all(...p); return { changes: rows.length, rows }; }
      return { changes: Number(st(sql).run(...p).changes), rows: [] };
    },
    exec: async (sql) => { db.exec(sql); },
  };
  // One transaction at a time; other queries wait until it has finished, so they never land inside it.
  let current = Promise.resolve();
  const idle = async () => { for (;;) { const c = current; await c; if (c === current) return; } };
  const outside = (fn) => async (...a) => { await idle(); return fn(...a); };
  return {
    dialect: 'sqlite',
    where: `local SQLite file (${file})`,
    get: outside(ops.get), all: outside(ops.all), run: outside(ops.run), exec: outside(ops.exec),
    async tx(fn) {
      const before = current;
      let release;
      current = new Promise((r) => { release = r; });
      await before;
      db.exec('BEGIN IMMEDIATE');
      try { const out = await fn(ops); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      finally { release(); }
    },
    async close() { db.close(); },
  };
}

// A password pasted as-is (with characters like @ # / ?) breaks a connection string; encode it.
function fixPassword(raw) {
  const m = String(raw).trim().replace(/^["']|["']$/g, '').match(/^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@]+)$/);
  if (!m) return String(raw).trim();
  let pw = m[3];
  try { pw = decodeURIComponent(pw); } catch { /* plain */ }
  return `${m[1]}${m[2]}:${encodeURIComponent(pw)}@${m[4]}`;
}

async function openPostgres(rawUrl) {
  rawUrl = fixPassword(rawUrl);
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => Number(v));    // BIGINT (counts, millisecond times) as plain numbers
  pg.types.setTypeParser(1700, (v) => Number(v));  // NUMERIC
  const url = new URL(rawUrl);
  url.searchParams.delete('sslmode');               // TLS is set below
  // Supabase's session pooler (port 5432) allows only a few connections at a time, which runs out as soon as
  // two copies of the app run (or many Vercel instances). Its transaction pooler (port 6543) is made for this,
  // so use it automatically. Every transaction here runs on one connection, which the transaction pooler supports.
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432' && process.env.SUPABASE_SESSION_POOLER !== '1') url.port = '6543';
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    // Supabase only accepts encrypted connections. Its certificate chain isn't in Node's default list,
    // so we encrypt without checking the chain unless SUPABASE_CA (path to Supabase's CA file) is given.
    ssl: local ? false : process.env.SUPABASE_CA
      ? { ca: (await import('node:fs')).readFileSync(process.env.SUPABASE_CA, 'utf8') }
      : { rejectUnauthorized: false },
    max: process.env.VERCEL ? 3 : 6,   // each Vercel instance keeps only a few connections open
    idleTimeoutMillis: 10 * 60_000,   // keep connections warm: opening a new one to Supabase takes a while
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (e) => console.error('[database] connection problem:', e.message));
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const ops = (c) => ({
    get: async (sql, ...p) => (await c.query(toPg(sql), p)).rows[0] ?? null,
    all: async (sql, ...p) => (await c.query(toPg(sql), p)).rows,
    run: async (sql, ...p) => { const r = await c.query(toPg(sql), p); return { changes: r.rowCount, rows: r.rows }; },
    exec: async (sql) => { await c.query(sql); },
  });
  await pool.query('SELECT 1'); // fail fast with a clear error if the connection string is wrong
  return {
    dialect: 'pg',
    where: `Postgres at ${url.hostname}${url.hostname.includes('supabase') ? ` (Supabase, ${url.port === '6543' ? 'transaction' : 'session'} pooler)` : ''}`,
    ...ops(pool),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(ops(c));
        await c.query('COMMIT');
        return out;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
}
