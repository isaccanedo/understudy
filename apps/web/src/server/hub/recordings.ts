import { and, eq } from "drizzle-orm";
import { DEFAULT_ASK_FIRST_RUNS, type Recipe } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import type { Hub } from "../hub";

export class Recordings {
  private byAgent = new Map<string, string>();

  constructor(private hub: Hub) {}

  active(agentId: string) {
    return this.byAgent.get(agentId) ?? null;
  }

  async start(agentId: string) {
    const existing = this.active(agentId);
    if (existing) return existing;
    const recordingId = newId("rec");
    await getDb().insert(schema.recordings).values({ id: recordingId, agentId });
    this.byAgent.set(agentId, recordingId);
    this.hub.sendToComputer(agentId, { type: "record_start", recordingId });
    this.hub.broadcast(agentId, { type: "recording", recordingId, status: "recording" });
    return recordingId;
  }

  async stop(agentId: string) {
    const recordingId = this.active(agentId);
    if (!recordingId) return null;
    this.byAgent.delete(agentId);
    await getDb()
      .update(schema.recordings)
      .set({ status: "processing", stoppedAt: new Date() })
      .where(eq(schema.recordings.id, recordingId));
    this.hub.sendToComputer(agentId, { type: "record_stop", recordingId });
    this.hub.broadcast(agentId, { type: "recording", recordingId, status: "processing" });
    return recordingId;
  }

  async startFromText(agentId: string, text: string, source: "computer" | "chat" = "computer") {
    const recordingId = newId("rec");
    await getDb().insert(schema.recordings).values({ id: recordingId, agentId, status: "processing", source });
    if (!this.hub.sendToComputer(agentId, { type: "teach_text", recordingId, text })) {
      await this.fail(agentId, recordingId);
      return null;
    }
    this.hub.broadcast(agentId, { type: "recording", recordingId, status: "processing" });
    return recordingId;
  }

  async saveRecipe(agentId: string, recordingId: string, draft: Recipe) {
    const db = getDb();
    const [recording] = await db
      .select()
      .from(schema.recordings)
      .where(and(eq(schema.recordings.id, recordingId), eq(schema.recordings.agentId, agentId)));
    if (!recording) return null;
    await db.update(schema.recordings).set({ status: "done" }).where(eq(schema.recordings.id, recordingId));
    const [existing] = await db.select().from(schema.recipes).where(eq(schema.recipes.recordingId, recordingId));
    const saved = { ...draft, askFirstRuns: existing ? existing.recipe.askFirstRuns : DEFAULT_ASK_FIRST_RUNS };
    if (existing) {
      await db.update(schema.recipes).set({ recipe: saved, updatedAt: new Date() }).where(eq(schema.recipes.id, existing.id));
      return { id: existing.id, recipe: saved, source: recording.source };
    }
    const id = newId("rcp");
    await db.insert(schema.recipes).values({ id, agentId, recordingId, recipe: saved, timezone: process.env.UNDERSTUDY_TIMEZONE?.trim() || "UTC" });
    return { id, recipe: saved, source: recording.source };
  }

  async fail(agentId: string, recordingId: string) {
    await getDb()
      .update(schema.recordings)
      .set({ status: "failed" })
      .where(and(eq(schema.recordings.id, recordingId), eq(schema.recordings.agentId, agentId)));
  }
}
