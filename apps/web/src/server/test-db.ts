import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "@/lib/db";

const LOCK_ID = 7_340_211;

export async function migrateTestDb() {
  const client = await getPool().connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await migrate(getDb(), { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
