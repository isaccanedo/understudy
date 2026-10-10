import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to a disposable Postgres to run";

if (url) process.env.DATABASE_URL = url;

const ids = { owner: "usr_room_owner", other: "usr_room_other", ada: "agt_room_ada", ben: "agt_room_ben", cleo: "agt_room_cleo", foreign: "agt_room_foreign" };

type Delivered = { agentId: string; message: { type: string; roomId?: string; prompt?: string } };

function fakeHub(online = true) {
  const delivered: Delivered[] = [];
  const hub = {
    delivered,
    isOnline: () => online,
    deliver: async (agentId: string, message: Delivered["message"]) => {
      delivered.push({ agentId, message });
      return online ? { status: "sent" } : { status: "queued", starting: true };
    },
  };
  return hub;
}

async function setup() {
  const { Rooms } = await import("./hub/rooms");
  const { createRoom } = await import("./room-store");
  const hub = fakeHub();
  const rooms = new Rooms(hub as never);
  const created = await createRoom(ids.owner, { name: "Launch", agentIds: [ids.ada, ids.ben, ids.cleo] });
  assert.equal(created.ok, true);
  return { hub, rooms, roomId: created.ok ? created.id : "" };
}

async function said(roomId: string) {
  const { getDb, schema } = await import("@/lib/db");
  const rows = await getDb().select().from(schema.roomMessages).where(eq(schema.roomMessages.roomId, roomId)).orderBy(schema.roomMessages.createdAt);
  return rows.map((row) => ({ author: row.author, agentId: row.agentId, text: row.text, depth: row.depth }));
}

before(async () => {
  if (!url) return;
  const { getDb, schema } = await import("@/lib/db");
  const db = getDb();
  await (await import("./test-db")).migrateTestDb();
  await db.delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.other]));
  await db.insert(schema.user).values([
    { id: ids.owner, name: "Jo", email: "room-owner@test.local", status: "approved" },
    { id: ids.other, name: "Other", email: "room-other@test.local", status: "approved" },
  ]);
  const tools = { notifyOwner: true, slack: false, slackChannels: [] };
  const look = { body: "pill", color: "#7FB2FF", eyes: "dot", acc: "none", accColor: "#2F3A56" };
  await db.insert(schema.agents).values([
    { id: ids.ada, ownerId: ids.owner, name: "Ada", role: "invoices", look, tokenHash: "hash_room_ada", tools } as never,
    { id: ids.ben, ownerId: ids.owner, name: "Ben", look, tokenHash: "hash_room_ben", tools } as never,
    { id: ids.cleo, ownerId: ids.owner, name: "Cleo", look, tokenHash: "hash_room_cleo", tools } as never,
    { id: ids.foreign, ownerId: ids.other, name: "Dora", look, tokenHash: "hash_room_foreign", tools } as never,
  ]);
  await db.insert(schema.agentMembers).values({ agentId: ids.foreign, userId: ids.owner, role: "approver" });
});

beforeEach(async () => {
  if (!url) return;
  const { getDb, schema } = await import("@/lib/db");
  await getDb().delete(schema.rooms).where(inArray(schema.rooms.ownerId, [ids.owner, ids.other]));
});

after(async () => {
  if (!url) return;
  const { getDb, schema, getPool } = await import("@/lib/db");
  await getDb().delete(schema.user).where(inArray(schema.user.id, [ids.owner, ids.other]));
  await getPool().end();
});

test("a room takes only the owner's own understudies, at least two, and only the owner can open it", { skip }, async () => {
  const { createRoom } = await import("./room-store");
  const { ownedRoom } = await import("./hub/rooms");
  assert.equal((await createRoom(ids.owner, { name: "Mixed", agentIds: [ids.ada, ids.foreign] })).ok, false);
  assert.equal((await createRoom(ids.owner, { name: "Alone", agentIds: [ids.ada] })).ok, false);
  assert.equal((await createRoom(ids.owner, { name: "  ", agentIds: [ids.ada, ids.ben] })).ok, false);
  assert.equal((await createRoom(ids.other, { name: "Theirs", agentIds: [ids.ada, ids.ben] })).ok, false);
  const created = await createRoom(ids.owner, { name: "Pair", agentIds: [ids.ada, ids.ben, ids.ada] });
  assert.ok(created.ok);
  if (!created.ok) return;
  assert.ok(await ownedRoom(created.id, ids.owner));
  assert.equal(await ownedRoom(created.id, ids.other), null);
});

test("the owner's message reaches every participant as a group turn, and a mention reaches only that one", { skip }, async () => {
  const { hub, rooms, roomId } = await setup();
  await rooms.ownerSaid(roomId, ids.owner, "Plan Monday");
  assert.deepEqual(hub.delivered.map((d) => d.agentId).sort(), [ids.ada, ids.ben, ids.cleo].sort());
  const prompt = hub.delivered.find((d) => d.agentId === ids.ada)?.message.prompt ?? "";
  assert.equal(hub.delivered[0].message.type, "room_turn");
  assert.match(prompt, /GROUP ROOM "Launch"/);
  assert.match(prompt, /You are: Ada/);
  assert.match(prompt, /- Ben\n- Cleo/);
  assert.match(prompt, /Jo \(owner\): "Plan Monday"/);

  for (const agentId of [ids.ada, ids.ben, ids.cleo]) await rooms.turnDone(agentId, roomId, true);
  hub.delivered.length = 0;
  await rooms.ownerSaid(roomId, ids.owner, "@Cleo just you");
  assert.deepEqual(hub.delivered.map((d) => d.agentId), [ids.cleo]);
});

test("someone else cannot speak in the owner's room", { skip }, async () => {
  const { hub, rooms, roomId } = await setup();
  await rooms.ownerSaid(roomId, ids.other, "hello");
  assert.equal(hub.delivered.length, 0);
  assert.deepEqual(await said(roomId), []);
});

test("an answer is posted under the understudy's name, PASS posts nothing, and a reply nobody asked for is dropped", { skip }, async () => {
  const { rooms, roomId } = await setup();
  await rooms.agentSaid(ids.ada, roomId, "not my turn");
  assert.deepEqual(await said(roomId), []);
  await rooms.ownerSaid(roomId, ids.owner, "hi");
  await rooms.agentSaid(ids.ada, roomId, "Hello from Ada");
  await rooms.agentSaid(ids.ben, roomId, "PASS");
  const rows = await said(roomId);
  assert.deepEqual(rows.slice(1), [{ author: "agent", agentId: ids.ada, text: "Hello from Ada", depth: 1 }]);
});

async function pingPong(rooms: { agentSaid: (a: string, r: string, t: string) => Promise<void>; turnDone: (a: string, r: string, ok: boolean) => Promise<void> }, roomId: string, exchanges: number) {
  let speaker = ids.ben;
  let listener = ids.ada;
  for (let turn = 0; turn < exchanges; turn++) {
    await rooms.agentSaid(speaker, roomId, `@${speaker === ids.ben ? "Ada" : "Ben"} back to you`);
    await rooms.turnDone(speaker, roomId, true);
    [speaker, listener] = [listener, speaker];
  }
}

test("with no ceiling set, understudies keep waking each other well past where they used to stop", { skip }, async () => {
  delete process.env.UNDERSTUDY_AGENT_TALK_CEILING;
  const { hub, rooms, roomId } = await setup();
  await rooms.ownerSaid(roomId, ids.owner, "@Ada start");
  await rooms.agentSaid(ids.ada, roomId, "@Ben your turn");
  assert.deepEqual(hub.delivered.map((d) => d.agentId), [ids.ada, ids.ben]);
  await rooms.turnDone(ids.ada, roomId, true);
  await pingPong(rooms, roomId, 10);
  assert.equal(hub.delivered.length, 12);
  const rows = await said(roomId);
  assert.equal(rows.filter((row) => row.author === "system").length, 0);
  assert.equal(rows.at(-1)?.depth, 11);
});

test("a ceiling set by the server stops the back and forth past it and says so in the room", { skip }, async () => {
  process.env.UNDERSTUDY_AGENT_TALK_CEILING = "3";
  try {
    const { hub, rooms, roomId } = await setup();
    await rooms.ownerSaid(roomId, ids.owner, "@Ada start");
    await rooms.agentSaid(ids.ada, roomId, "@Ben your turn");
    await rooms.turnDone(ids.ada, roomId, true);
    await pingPong(rooms, roomId, 4);
    assert.equal(hub.delivered.length, 3);
    const rows = await said(roomId);
    assert.equal(rows.at(-1)?.author, "system");
    assert.match(rows.at(-1)?.text ?? "", /after 3 turns in a row/);
  } finally {
    delete process.env.UNDERSTUDY_AGENT_TALK_CEILING;
  }
});

test("a mention of someone already working queues one more look instead of a parallel turn", { skip }, async () => {
  const { hub, rooms, roomId } = await setup();
  await rooms.ownerSaid(roomId, ids.owner, "everyone think");
  hub.delivered.length = 0;
  await rooms.agentSaid(ids.ada, roomId, "@Ben look at this");
  assert.equal(hub.delivered.length, 0);
  await rooms.turnDone(ids.ben, roomId, true);
  assert.deepEqual(hub.delivered.map((d) => d.agentId), [ids.ben]);
});

test("an understudy that already said a lot this hour still wakes the teammate it names", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { newId } = await import("@/lib/ids");
  const { hub, rooms, roomId } = await setup();
  await getDb()
    .insert(schema.roomMessages)
    .values(Array.from({ length: 60 }, () => ({ id: newId("rmsg"), roomId, author: "agent" as const, agentId: ids.ada, text: "x", depth: 1 })));
  await rooms.ownerSaid(roomId, ids.owner, "@Ada go");
  hub.delivered.length = 0;
  await rooms.agentSaid(ids.ada, roomId, "@Ben please");
  assert.deepEqual(hub.delivered.map((d) => d.agentId), [ids.ben]);
});

test("Stop ends every running turn at once: late answers are dropped, nobody else is woken and queued turns are gone", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { newId } = await import("@/lib/ids");
  const { hub, rooms, roomId } = await setup();
  await rooms.ownerSaid(roomId, ids.owner, "everyone go");
  await getDb()
    .insert(schema.inboundQueue)
    .values({ id: newId("inq"), agentId: ids.cleo, message: { type: "room_turn", roomId, prompt: "x" }, source: "room", expiresAt: new Date(Date.now() + 60_000) });
  assert.equal(await rooms.stop(roomId, ids.other), false);
  assert.equal(await rooms.stop(roomId, ids.owner), true);
  const participants = await getDb().select().from(schema.roomParticipants).where(eq(schema.roomParticipants.roomId, roomId));
  assert.ok(participants.every((row) => row.turnStartedAt === null && !row.followUp));
  assert.equal((await getDb().select().from(schema.inboundQueue).where(eq(schema.inboundQueue.agentId, ids.cleo))).length, 0);
  hub.delivered.length = 0;
  await rooms.agentSaid(ids.ada, roomId, "@Ben keep going");
  await rooms.turnDone(ids.ada, roomId, true);
  assert.equal(hub.delivered.length, 0);
  const rows = await said(roomId);
  assert.equal(rows.at(-1)?.author, "system");
  assert.match(rows.at(-1)?.text ?? "", /You stopped the conversation/);
  await rooms.ownerSaid(roomId, ids.owner, "@Ben back to work");
  assert.deepEqual(hub.delivered.map((d) => d.agentId), [ids.ben]);
});

test("a failed or timed out turn clears the working state and says so in the room", { skip }, async () => {
  const { getDb, schema } = await import("@/lib/db");
  const { rooms, roomId } = await setup();
  await rooms.ownerSaid(roomId, ids.owner, "@Ada go");
  await rooms.turnDone(ids.ada, roomId, false, "brain down");
  assert.match((await said(roomId)).at(-1)?.text ?? "", /Ada could not answer: brain down/);
  await rooms.ownerSaid(roomId, ids.owner, "@Ben go");
  await getDb().update(schema.roomParticipants).set({ turnStartedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(schema.roomParticipants.agentId, ids.ben));
  await rooms.expireStale();
  const [ben] = await getDb().select().from(schema.roomParticipants).where(eq(schema.roomParticipants.agentId, ids.ben));
  assert.equal(ben.turnStartedAt, null);
});
