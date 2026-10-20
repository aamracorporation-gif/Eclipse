import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import type { Row } from '../src/domain/model.ts';
export interface DB {
  query<T extends Row = Row>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}
export interface Database extends DB {
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
const schema = new URL('./schema.sql', import.meta.url);
export async function openDatabase(path = 'data/postgres', databaseUrl?: string): Promise<Database> {
  if (databaseUrl) {
    const destination=new URL(databaseUrl),project=process.env.REMOTE_PROJECT_REF;
    if(!['postgres:','postgresql:'].includes(destination.protocol)||destination.search||destination.hash)
      throw new Error('Use a PostgreSQL URL without additional connection options.');
    if (!['approved-separate-project','approved-existing-project'].includes(process.env.ALLOW_REMOTE_DATABASE || '') ||
        !project || !/^[a-z]{20}$/.test(project) ||
        !(destination.hostname===`db.${project}.supabase.co` ||
          (destination.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(destination.username).endsWith(`.${project}`))))
      throw new Error('Remote DB disabled: explicit project reference and approved configuration required.');
    if (!['rondiqo_backend',`rondiqo_backend.${project}`].includes(decodeURIComponent(destination.username)))
      throw new Error('Use a dedicated RONDIQO database login, never the Eclipse owner credentials.');
    // URL query options can override pg's host, identity or TLS configuration.
    // They are rejected above before passing the connection string to pg.
    const ca=await readFile(new URL('../certs/supabase-prod-ca-2021.crt',import.meta.url),'utf8');
    // Two existing replicas share the dedicated role's five-connection limit.
    const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis:15000,
      ssl: { rejectUnauthorized: true, ca } });
    // No automatic remote migrations.
    return {
      query: async (sql, params) => pool.query(sql, params),
      transaction: async fn => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Small-pilot write serialization. Replace with scoped locks after load testing.
          await client.query('SELECT pg_advisory_xact_lock(17012026)');
          const result = await fn(client);
          await client.query('COMMIT'); return result;
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  const pg = new PGlite(path === ':memory:' ? undefined : path);
  await pg.exec(await readFile(schema, 'utf8'));
  let gate = Promise.resolve();
  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = gate; let done!: () => void;
    gate = new Promise<void>(r => { done = r; });
    await previous; try { return await fn(); } finally { done(); }
  }
  return {
    query: (sql, params) => exclusive(() => pg.query(sql, params)),
    transaction: fn => exclusive(() => pg.transaction(tx => fn({ query: (s, p) => tx.query(s, p) }))),
    close: () => pg.close(),
  };
}
export async function one<T extends Row = Row>(db: DB, sql: string, params: any[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}
