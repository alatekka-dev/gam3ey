/**
 * Database access layer.
 *
 * GAM3EY targets PostgreSQL. Two drivers are supported behind one interface:
 *  - DATABASE_URL set  -> a real PostgreSQL server through `pg` (production).
 *  - otherwise         -> PGlite, PostgreSQL compiled to WebAssembly, running
 *                         in-process (development, demos and automated tests).
 * The same SQL (including SELECT ... FOR UPDATE row locks) runs on both.
 */
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema.js';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

export interface Database extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrap(run: (sql: string, params?: unknown[]) => Promise<any[]>): Queryable {
  return {
    query: (sql, params) => run(sql, params),
    one: async (sql, params) => (await run(sql, params))[0],
  };
}

async function createPglite(dataDir?: string): Promise<Database> {
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  const base = wrap(async (sql, params) => (await db.query(sql, params as any[])).rows as any[]);
  return {
    ...base,
    // PGlite runs one transaction at a time, so concurrent transactions are
    // serialised; the row locks used below are still required on real Postgres.
    tx: (fn) => db.transaction(async (t) => fn(wrap(async (sql, params) => (await t.query(sql, params as any[])).rows as any[]))),
    close: () => db.close(),
  };
}

async function createPg(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url });
  const base = wrap(async (sql, params) => (await pool.query(sql, params as any[])).rows);
  return {
    ...base,
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(async (sql, params) => (await client.query(sql, params as any[])).rows));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createDatabase(opts: { url?: string; dataDir?: string; memory?: boolean } = {}): Promise<Database> {
  const db = opts.url ? await createPg(opts.url) : await createPglite(opts.memory ? undefined : opts.dataDir);
  await migrate(db);
  return db;
}

async function migrate(db: Database) {
  // Split on statement terminators; schema contains no procedural bodies.
  for (const stmt of SCHEMA_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
}
