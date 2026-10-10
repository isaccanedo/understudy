import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";

if (url) process.env.DATABASE_URL = url;
process.env.UNDERSTUDY_PUBLIC_URL = "https://understudy.example.test";

const ids = { owner: "usr_task_owner", agent: "agt_task_mine" };

before(async () => {
  if (!url) return;
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await db.delete(schema.user).where(eq(schema.user.id, ids.owner));
  await db.insert(schema.user).values({ id: ids.owner, name: "Owner", email: "task-owner@test.local", status: "approved" });
  const tools = { notifyOwner: true, slack: false, slackChannels: [] };
  const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
  await db.insert(schema.agents).values({ id: ids.agent, ownerId: ids.owner, name: "Ada", look, tokenHash: "hash_task_mine", tools } as never);
});

after(async () => {
  if (!url) return;
  const { getDb, schema, getPool } = await import("@/lib/db");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner]));
  await getPool().end();
});

async function connectedHub(online = true) {
  const { Hub } = await import("./hub");
  const hub = new Hub();
  const sent: { type: string; recordingId?: string; text?: string }[] = [];
  hub.sendToComputer = ((_agentId: string, message: { type: string }) => {
    if (!online) return false;
    sent.push(message);
    return true;
  }) as typeof hub.sendToComputer;
  return { hub, sent };
}

async function saveTask(hub: unknown, description: string) {
  const { taskTools } = await import("./task-tools");
  const tool = taskTools(hub as never, { id: ids.agent }).find((t) => t.name === "save_task")!;
  const parsed = tool.schema.parse({ description });
  return (tool.run as unknown as (args: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)(parsed);
}

test("save_task sends the owner's routine down the describe path, and the finished recipe lands paused in Tasks with a link in the chat", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { computerHandlers } = await import("./hub/computer-handlers");
  const db = getDb();
  const { hub, sent } = await connectedHub();
  const description = "Every Monday at 9am, open the supplier portal, download last week's invoices and file them in the shared folder. Never pay anything.";

  const result = await saveTask(hub, description);
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /^accepted:/);
  assert.match(result.content[0].text, /not saved yet/i);
  assert.ok(result.content[0].text.includes(`https://understudy.example.test/agents/${ids.agent}?tab=tasks`));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "teach_text");
  assert.equal(sent[0].text, description);
  const recordingId = sent[0].recordingId!;
  const [recording] = await db.select().from(schema.recordings).where(eq(schema.recordings.id, recordingId));
  assert.equal(recording.source, "chat");
  assert.equal(recording.status, "processing");

  const recipe = { title: "File supplier invoices", trigger: "every Monday at 9am", steps: [{ id: "s1", text: "Download last week's invoices", mode: "auto" as const }], questions: [], askFirstRuns: 3 };
  await computerHandlers.recipe(hub, ids.agent, { type: "recipe", recordingId, recipe });

  const [saved] = await db.select().from(schema.recipes).where(eq(schema.recipes.recordingId, recordingId));
  assert.equal(saved.agentId, ids.agent);
  assert.equal(saved.active, false);
  assert.equal(saved.recipe.title, "File supplier invoices");
  const chat = await db.select().from(schema.messages).where(eq(schema.messages.agentId, ids.agent));
  const notice = chat.find((m) => m.role === "system" && m.text.includes("File supplier invoices"));
  assert.ok(notice, "the owner is told in the chat that the task was saved");
  assert.ok(notice.text.includes(`https://understudy.example.test/agents/${ids.agent}/recipes/${saved.id}`));
});

test("a recipe taught on the Teach page does not post a chat notice", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { computerHandlers } = await import("./hub/computer-handlers");
  const db = getDb();
  const { hub } = await connectedHub();
  const recordingId = (await hub.recordings.startFromText(ids.agent, "Check the shared inbox every morning"))!;
  const before = (await db.select().from(schema.messages).where(eq(schema.messages.agentId, ids.agent))).length;
  const recipe = { title: "Check the inbox", trigger: "every morning", steps: [{ id: "s1", text: "Open the inbox", mode: "auto" as const }], questions: [], askFirstRuns: 3 };
  await computerHandlers.recipe(hub, ids.agent, { type: "recipe", recordingId, recipe });
  const afterCount = (await db.select().from(schema.messages).where(eq(schema.messages.agentId, ids.agent))).length;
  assert.equal(afterCount, before);
});

test("save_task reports failure instead of success when the computer is not connected", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { hub } = await connectedHub(false);
  const result = await saveTask(hub, "Send the weekly report to the team every Friday");
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^not saved/);
  const rows = await getDb().select().from(schema.recordings).where(eq(schema.recordings.agentId, ids.agent));
  assert.deepEqual(rows.filter((row) => row.status === "failed").map((row) => row.source), ["chat"]);
});
