import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";
if (url) process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET ??= "test-secret";

const users = { a: "usr_push_a", b: "usr_push_b" };

before(async () => {
  if (!url) return;
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await db.delete(schema.user).where(eq(schema.user.id, users.a));
  await db.delete(schema.user).where(eq(schema.user.id, users.b));
  await db.insert(schema.user).values([
    { id: users.a, name: "A", email: "push-a@test.local", status: "approved" },
    { id: users.b, name: "B", email: "push-b@test.local", status: "approved" },
  ]);
});

after(async () => {
  if (!url) return;
  const { getDb, schema, getPool } = await import("@/lib/db");
  await getDb().delete(schema.user).where(eq(schema.user.id, users.a));
  await getDb().delete(schema.user).where(eq(schema.user.id, users.b));
  await getPool().end();
});

test("the push keys are created once, stored sealed, and stay the same", { skip }, async () => {
  const { vapidKeys } = await import("./push");
  const { getDb, schema } = await import("@/lib/db");
  const first = await vapidKeys();
  const [row] = await getDb().select().from(schema.appSettings).where(eq(schema.appSettings.key, "vapid"));
  assert.equal(row.value.publicKey, first.publicKey);
  assert.notEqual(row.value.privateKey, first.privateKey);
  assert.deepEqual(await vapidKeys(), first);
});

test("subscriptions need an https endpoint and keys, and only their owner removes them", { skip }, async () => {
  const { saveSubscription, removeSubscription } = await import("./push");
  const { getDb, schema } = await import("@/lib/db");
  await assert.rejects(saveSubscription(users.a, { endpoint: "http://push.example/x", keys: { p256dh: "k", auth: "a" } }));
  await assert.rejects(saveSubscription(users.a, { endpoint: "https://push.example/x", keys: { p256dh: "", auth: "a" } }));
  await saveSubscription(users.a, { endpoint: "https://push.example/sub-1", keys: { p256dh: "k", auth: "a" } });
  await removeSubscription(users.b, "https://push.example/sub-1");
  const kept = await getDb().select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, "https://push.example/sub-1"));
  assert.equal(kept.length, 1);
  await removeSubscription(users.a, "https://push.example/sub-1");
  const gone = await getDb().select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, "https://push.example/sub-1"));
  assert.equal(gone.length, 0);
});
