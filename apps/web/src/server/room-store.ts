import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { cleanRoomName, ROOM_LIMITS } from "@/lib/rooms";

export type CreateRoomResult = { ok: true; id: string } | { ok: false; error: string };

export async function createRoom(ownerId: string, input: { name: unknown; agentIds: unknown[] }): Promise<CreateRoomResult> {
  const name = cleanRoomName(input.name);
  if (!name) return { ok: false, error: messages.rooms.nameRequired };
  const wanted = [...new Set(input.agentIds.map(String).filter(Boolean))].slice(0, ROOM_LIMITS.maxParticipants + 1);
  if (wanted.length < ROOM_LIMITS.minParticipants) return { ok: false, error: messages.rooms.pickMore(ROOM_LIMITS.minParticipants) };
  if (wanted.length > ROOM_LIMITS.maxParticipants) return { ok: false, error: messages.rooms.whoHint(ROOM_LIMITS.minParticipants, ROOM_LIMITS.maxParticipants) };
  const db = getDb();
  const own = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(inArray(schema.agents.id, wanted), eq(schema.agents.ownerId, ownerId)));
  if (own.length !== wanted.length) return { ok: false, error: messages.rooms.notYours };
  const id = newId("room");
  await db.transaction(async (tx) => {
    await tx.insert(schema.rooms).values({ id, ownerId, name });
    await tx.insert(schema.roomParticipants).values(wanted.map((agentId) => ({ roomId: id, agentId })));
  });
  console.log(JSON.stringify({ event: "room_created", roomId: id, ownerId, participants: wanted.length }));
  return { ok: true, id };
}

export async function deleteOwnedRoom(ownerId: string, roomId: string) {
  const deleted = await getDb()
    .delete(schema.rooms)
    .where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.ownerId, ownerId)))
    .returning({ id: schema.rooms.id });
  return deleted.length > 0;
}

export async function listRooms(ownerId: string) {
  const db = getDb();
  const rooms = await db.select().from(schema.rooms).where(eq(schema.rooms.ownerId, ownerId)).orderBy(desc(schema.rooms.updatedAt));
  if (!rooms.length) return [];
  const ids = rooms.map((room) => room.id);
  const members = await db
    .select({ roomId: schema.roomParticipants.roomId, id: schema.agents.id, name: schema.agents.name, look: schema.agents.look, state: schema.agents.state })
    .from(schema.roomParticipants)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.roomParticipants.agentId))
    .where(inArray(schema.roomParticipants.roomId, ids));
  const latest = await db
    .selectDistinctOn([schema.roomMessages.roomId], { roomId: schema.roomMessages.roomId, text: schema.roomMessages.text, author: schema.roomMessages.author, agentId: schema.roomMessages.agentId, createdAt: schema.roomMessages.createdAt })
    .from(schema.roomMessages)
    .where(inArray(schema.roomMessages.roomId, ids))
    .orderBy(schema.roomMessages.roomId, desc(schema.roomMessages.createdAt));
  return rooms.map((room) => ({
    ...room,
    members: members.filter((member) => member.roomId === room.id),
    last: latest.find((row) => row.roomId === room.id) ?? null,
  }));
}

export async function loadRoomMessages(roomId: string, limit = 200) {
  const rows = await getDb().select().from(schema.roomMessages).where(eq(schema.roomMessages.roomId, roomId)).orderBy(desc(schema.roomMessages.createdAt)).limit(limit);
  return rows.reverse();
}
