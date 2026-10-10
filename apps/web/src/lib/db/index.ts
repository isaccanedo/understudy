import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

const store = globalThis as unknown as { __understudyDb?: { pool: pg.Pool; db: Db } };

function create() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
}

export function getDb(): Db {
  store.__understudyDb ??= create();
  return store.__understudyDb.db;
}

export function getPool(): pg.Pool {
  store.__understudyDb ??= create();
  return store.__understudyDb.pool;
}

export { schema };
