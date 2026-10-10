import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { RoomInside } from "@/components/rooms/RoomInside";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { getHub } from "@/server/hub-access";
import { ownedRoom, roomMembers, toRoomEntry } from "@/server/hub/rooms";
import { loadRoomMessages } from "@/server/room-store";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const room = await ownedRoom(id, user.id);
  if (!room) notFound();
  const [members, history] = await Promise.all([roomMembers(id), loadRoomMessages(id)]);
  const agents = members.length
    ? await getDb()
        .select({ id: schema.agents.id, look: schema.agents.look, state: schema.agents.state })
        .from(schema.agents)
        .where(inArray(schema.agents.id, members.map((member) => member.id)))
    : [];
  const hub = getHub();
  return (
    <RoomInside
      room={{ id: room.id, name: room.name }}
      members={members.map((member) => {
        const agent = agents.find((a) => a.id === member.id);
        return { id: member.id, name: member.name, role: member.role ?? "", look: agent?.look ?? ({} as never), state: agent?.state ?? "calm", online: hub?.isOnline(member.id) ?? false };
      })}
      initial={history.map(toRoomEntry)}
      ceiling={env.agentTalkCeiling}
    />
  );
}
