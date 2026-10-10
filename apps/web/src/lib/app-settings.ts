import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { open, seal } from "./secret-box";

export async function readSetting(key: string, secretFields: string[] = []) {
  const [row] = await getDb().select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  if (!row) return null;
  const value = { ...row.value };
  for (const field of secretFields) if (value[field]) value[field] = open(value[field]);
  return value;
}

export async function writeSetting(key: string, value: Record<string, string>, secretFields: string[] = []) {
  const stored = { ...value };
  for (const field of secretFields) if (stored[field]) stored[field] = seal(stored[field]);
  await getDb()
    .insert(schema.appSettings)
    .values({ key, value: stored, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: stored, updatedAt: new Date() } });
}

export async function writeSettingIfMissing(key: string, value: Record<string, string>, secretFields: string[] = []) {
  const stored = { ...value };
  for (const field of secretFields) if (stored[field]) stored[field] = seal(stored[field]);
  await getDb().insert(schema.appSettings).values({ key, value: stored, updatedAt: new Date() }).onConflictDoNothing();
}

export async function deleteSetting(key: string) {
  await getDb().delete(schema.appSettings).where(eq(schema.appSettings.key, key));
}
