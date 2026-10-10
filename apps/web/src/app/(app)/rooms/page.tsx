import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { AgentFigure } from "@/components/AgentFigure";
import { AutoRefresh } from "@/components/AutoRefresh";
import { NewRoomForm } from "@/components/rooms/NewRoomForm";
import { accessibleAgentIds } from "@/lib/access";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { formatWhen } from "@/lib/format";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { ROOM_LIMITS } from "@/lib/rooms";
import { requireUser } from "@/lib/session";
import { listPairs } from "@/server/pair-threads";
import { listRooms } from "@/server/room-store";

type Face = { id: string; name: string; look: Look; state: (typeof schema.agents.$inferSelect)["state"] };

type Item = {
  key: string;
  href: string;
  title: string;
  people: string;
  faces: Face[];
  author: string | null;
  line: string;
  at: Date;
  tag: string;
  stopped: boolean;
};

function pairLine(kind: string, text: string, task: string | null) {
  const t = messages.rooms;
  if (kind === "stop") return t.pairStoppedLine;
  if (kind === "resume") return t.pairResumedLine;
  if (kind === "handoff") return `${t.handoff(task ?? "")}: ${text}`;
  return text;
}

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const user = await requireUser();
  const t = messages.rooms;
  const db = getDb();
  const [rooms, agents, visible, query] = await Promise.all([
    listRooms(user.id),
    db
      .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role, look: schema.agents.look })
      .from(schema.agents)
      .where(eq(schema.agents.ownerId, user.id))
      .orderBy(desc(schema.agents.createdAt)),
    accessibleAgentIds(user.id),
    searchParams,
  ]);
  const pairs = await listPairs(visible);
  const pairAgentIds = [...new Set(pairs.flatMap((pair) => pair.ids))];
  const pairAgents = pairAgentIds.length
    ? await db
        .select({ id: schema.agents.id, name: schema.agents.name, look: schema.agents.look, state: schema.agents.state })
        .from(schema.agents)
        .where(inArray(schema.agents.id, pairAgentIds))
    : [];
  const byId = new Map(pairAgents.map((agent) => [agent.id, agent]));

  const items: Item[] = [
    ...rooms.map((room) => ({
      key: room.id,
      href: `/rooms/${room.id}`,
      title: room.name,
      people: room.members.map((member) => member.name).join(", "),
      faces: room.members,
      author: room.last?.author === "owner" ? messages.live.you : room.last?.author === "agent" ? (room.members.find((m) => m.id === room.last?.agentId)?.name ?? null) : null,
      line: room.last?.text ?? t.noMessages,
      at: room.last?.createdAt ?? room.createdAt,
      tag: t.roomTag,
      stopped: false,
    })),
    ...pairs.flatMap((pair) => {
      const faces = pair.ids.map((id) => byId.get(id)).filter((agent): agent is Face => Boolean(agent));
      if (faces.length !== 2) return [];
      const control = pair.last.kind === "stop" || pair.last.kind === "resume";
      return [
        {
          key: pair.ids.join("|"),
          href: `/rooms/pair/${pair.ids[0]}/${pair.ids[1]}`,
          title: t.pairName(faces[0].name, faces[1].name),
          people: "",
          faces,
          author: control ? null : (byId.get(pair.last.fromAgentId)?.name ?? null),
          line: pairLine(pair.last.kind, pair.last.text, pair.last.task),
          at: pair.last.createdAt,
          tag: t.pairTag,
          stopped: pair.stopped,
        },
      ];
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const own = new Set(agents.map((agent) => agent.id));
  const preset = (query.with ?? "").split(",").filter((id) => own.has(id));

  return (
    <div className="page narrow">
      <AutoRefresh seconds={15} />
      <div className="top">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col gap-5 py-5">
        {agents.length >= ROOM_LIMITS.minParticipants ? (
          <NewRoomForm agents={agents} startOpen={items.length === 0 || preset.length > 0} initialPicked={preset} />
        ) : (
          <div className="card p-[18px] text-smoke text-[13px]">{t.needTwo}</div>
        )}
        {items.length === 0 && agents.length >= ROOM_LIMITS.minParticipants && <p className="text-smoke text-[13px] m-0">{t.empty}</p>}
        <ul className="m-0 p-0 list-none flex flex-col gap-3" aria-label={t.title}>
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="card rm-card no-underline">
                <span className="rm-stack" aria-hidden>
                  {item.faces.slice(0, 4).map((face) => (
                    <span key={face.id} className="rm-stack-item">
                      <AgentFigure size={34} look={face.look} state={face.state} live={false} />
                    </span>
                  ))}
                </span>
                <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="font-semibold text-[15px] tracking-[-0.015em] truncate text-white">{item.title}</span>
                    {item.people && <span className="text-smoke text-[12px] truncate max-[600px]:hidden">{item.people}</span>}
                  </span>
                  <span className="text-ash text-[12.5px] truncate">
                    {item.author && <b className="text-mist font-medium">{item.author}: </b>}
                    {item.line}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 flex-none">
                  <span className="text-smoke text-[11.5px]" suppressHydrationWarning>
                    {formatWhen(item.at)}
                  </span>
                  <span className="rm-card-tags">
                    {item.stopped && <span className="pill c">{t.stoppedTag}</span>}
                    <span className={`pill ${item.stopped ? "rm-tag-secondary" : ""}`}>{item.tag}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-smoke text-[12px] m-0">{t.talkNote(env.agentTalkCeiling)}</p>
      </div>
    </div>
  );
}
