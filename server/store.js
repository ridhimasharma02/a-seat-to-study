// One database API for two databases:
//   - Supabase (Postgres), when DATABASE_URL is set (see `npm run connect-supabase`)
//   - a local SQLite file otherwise, so the app still runs offline
// Queries are written once with ? placeholders; every call is async.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function openStore({ url, file }) {
  return url ? openPostgres(url) : openSqlite(file);
}

function openSqlite(file) {
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

async function openPostgres(rawUrl) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => Number(v));    // BIGINT (counts, millisecond times) as plain numbers
  pg.types.setTypeParser(1700, (v) => Number(v));  // NUMERIC
  const url = new URL(rawUrl);
  url.searchParams.delete('sslmode');               // TLS is set below
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const pool = new pg.Pool({
    connectionString: url.toString(),
    // Supabase only accepts encrypted connections. Its certificate chain isn't in Node's default list,
    // so we encrypt without checking the chain unless SUPABASE_CA (path to Supabase's CA file) is given.
    ssl: local ? false : process.env.SUPABASE_CA
      ? { ca: (await import('node:fs')).readFileSync(process.env.SUPABASE_CA, 'utf8') }
      : { rejectUnauthorized: false },
    max: 8,
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
    where: `Postgres at ${url.hostname}${url.hostname.includes('supabase') ? ' (Supabase)' : ''}`,
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
