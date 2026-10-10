import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TeachChoice } from "@/components/teach/TeachChoice";
import { TeachSession } from "@/components/teach/TeachSession";
import { getDb, schema } from "@/lib/db";
import { requireOwnAgent } from "@/lib/session";
import { getHub } from "@/server/hub-access";

async function eventsOf(recordingId: string) {
  const rows = await getDb()
    .select({ event: schema.recordedEvents.event })
    .from(schema.recordedEvents)
    .where(eq(schema.recordedEvents.recordingId, recordingId))
    .orderBy(asc(schema.recordedEvents.seq));
  return rows.map((row) => row.event);
}

export default async function TeachPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string }> }) {
  const { id } = await params;
  const { mode } = await searchParams;
  const { user, agent } = await requireOwnAgent(id);
  const view = {
    id: agent.id,
    name: agent.name,
    look: agent.look,
    state: agent.state,
    computerStatus: agent.computerStatus,
    brains: agent.brains,
  };
  const recordingId = getHub()?.activeRecording(id);
  if (mode === "remote" || recordingId) {
    return <TeachSession agent={view} initialEvents={recordingId ? await eventsOf(recordingId) : []} />;
  }
  const db = getDb();
  const [browser] = await db
    .select({ id: schema.recordings.id })
    .from(schema.recordings)
    .where(and(eq(schema.recordings.agentId, id), eq(schema.recordings.source, "browser"), inArray(schema.recordings.status, ["recording", "processing"])))
    .orderBy(desc(schema.recordings.startedAt))
    .limit(1);
  const [token] = await db.select({ id: schema.extensionTokens.id }).from(schema.extensionTokens).where(eq(schema.extensionTokens.userId, user.id)).limit(1);
  return <TeachChoice agent={view} extensionConnected={Boolean(token)} initialEvents={browser ? await eventsOf(browser.id) : []} />;
}
