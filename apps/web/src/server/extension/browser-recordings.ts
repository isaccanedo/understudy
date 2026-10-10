import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { RecordedEventSchema, sanitizeBrowserEvent, type RecordedEvent } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { messages as copy } from "@/lib/messages";
import type { Hub } from "../hub";
import { log } from "../hub/shared";
import { mergeTimeline, narrationFromTranscript } from "./narration";
import type { Transcriber } from "./transcriber";

export const MAX_EVENTS_PER_BATCH = 200;
export const MAX_EVENTS_PER_RECORDING = 3000;
export const MAX_CLIPS_PER_RECORDING = 60;
export const MAX_CLIP_BYTES = 20 * 1024 * 1024;
export const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;

type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

function refuse<T>(status: number, error: string): Outcome<T> {
  return { ok: false, status, error };
}

export function cleanBrowserEvents(raw: unknown): RecordedEvent[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS_PER_BATCH) return null;
  const events: RecordedEvent[] = [];
  for (const item of raw) {
    const parsed = RecordedEventSchema.safeParse(item);
    if (!parsed.success) continue;
    const event = sanitizeBrowserEvent(parsed.data);
    if (event) events.push(event);
  }
  return events;
}

export function audioMediaType(header: string | undefined) {
  const type = (header ?? "").split(";")[0].trim().toLowerCase();
  return /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav)$/.test(type) ? type : null;
}

export class BrowserRecordings {
  constructor(
    private hub: Hub,
    private transcriber: () => Transcriber | null,
  ) {}

  async ownedAgent(userId: string, agentId: string) {
    const [agent] = await getDb()
      .select({ id: schema.agents.id, name: schema.agents.name })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, userId)));
    return agent ?? null;
  }

  private async ownedRecording(userId: string, recordingId: string) {
    const [row] = await getDb()
      .select({ recording: schema.recordings, ownerId: schema.agents.ownerId })
      .from(schema.recordings)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.recordings.agentId))
      .where(and(eq(schema.recordings.id, recordingId), eq(schema.recordings.source, "browser")));
    if (!row || row.ownerId !== userId) return null;
    return row.recording;
  }

  async start(userId: string, agentId: string): Promise<Outcome<{ recordingId: string }>> {
    const agent = await this.ownedAgent(userId, agentId);
    if (!agent) return refuse(404, "agent_not_found");
    const db = getDb();
    const previous = await db
      .update(schema.recordings)
      .set({ status: "failed", stoppedAt: new Date() })
      .where(and(eq(schema.recordings.agentId, agentId), eq(schema.recordings.source, "browser"), eq(schema.recordings.status, "recording")))
      .returning({ id: schema.recordings.id });
    if (previous.length) await db.delete(schema.recordingAudio).where(inArray(schema.recordingAudio.recordingId, previous.map((row) => row.id)));
    const recordingId = newId("rec");
    await db.insert(schema.recordings).values({ id: recordingId, agentId, source: "browser" });
    log("browser_recording_started", { agentId, recordingId });
    return { ok: true, value: { recordingId } };
  }

  async expireAbandoned(now = new Date()) {
    const db = getDb();
    const abandoned = await db
      .update(schema.recordings)
      .set({ status: "failed", stoppedAt: now })
      .where(and(eq(schema.recordings.source, "browser"), eq(schema.recordings.status, "recording"), lt(schema.recordings.startedAt, new Date(now.getTime() - ABANDONED_AFTER_MS))))
      .returning({ id: schema.recordings.id });
    if (!abandoned.length) return 0;
    await db.delete(schema.recordingAudio).where(inArray(schema.recordingAudio.recordingId, abandoned.map((row) => row.id)));
    log("browser_recordings_abandoned", { count: abandoned.length });
    return abandoned.length;
  }

  async addEvents(userId: string, recordingId: string, raw: unknown): Promise<Outcome<{ accepted: number }>> {
    const events = cleanBrowserEvents(raw);
    if (!events) return refuse(400, "invalid_events");
    const recording = await this.ownedRecording(userId, recordingId);
    if (!recording) return refuse(404, "recording_not_found");
    if (recording.status !== "recording") return refuse(409, "recording_closed");
    if (!events.length) return { ok: true, value: { accepted: 0 } };
    const db = getDb();
    const [{ count, last }] = await db
      .select({ count: sql<number>`count(*)`, last: sql<number>`coalesce(max(${schema.recordedEvents.seq}), 0)` })
      .from(schema.recordedEvents)
      .where(eq(schema.recordedEvents.recordingId, recordingId));
    const room = MAX_EVENTS_PER_RECORDING - Number(count);
    if (room <= 0) return refuse(413, "too_many_events");
    const kept = events.slice(0, room);
    const rows = kept.map((event, index) => ({ id: newId("evt"), recordingId, seq: Number(last) + index + 1, event }));
    await db.insert(schema.recordedEvents).values(rows);
    for (const row of rows) this.hub.broadcast(recording.agentId, { type: "recorded", recordingId, seq: row.seq, event: row.event });
    return { ok: true, value: { accepted: kept.length } };
  }

  async addAudio(userId: string, recordingId: string, startedAt: number, mediaType: string, audio: Buffer): Promise<Outcome<{ clipId: string }>> {
    if (!Number.isFinite(startedAt) || startedAt <= 0) return refuse(400, "invalid_started_at");
    if (!audio.length) return refuse(400, "empty_audio");
    const recording = await this.ownedRecording(userId, recordingId);
    if (!recording) return refuse(404, "recording_not_found");
    if (recording.status !== "recording") return refuse(409, "recording_closed");
    const db = getDb();
    const [{ clips }] = await db
      .select({ clips: sql<number>`count(*)` })
      .from(schema.recordingAudio)
      .where(eq(schema.recordingAudio.recordingId, recordingId));
    if (Number(clips) >= MAX_CLIPS_PER_RECORDING) return refuse(413, "too_many_clips");
    const clipId = newId("aud");
    await db.insert(schema.recordingAudio).values({ id: clipId, recordingId, startedAt: Math.round(startedAt), mediaType, audio });
    return { ok: true, value: { clipId } };
  }

  async discard(userId: string, recordingId: string): Promise<Outcome<null>> {
    const recording = await this.ownedRecording(userId, recordingId);
    if (!recording) return refuse(404, "recording_not_found");
    if (recording.status !== "recording") return refuse(409, "recording_closed");
    await getDb().delete(schema.recordings).where(eq(schema.recordings.id, recordingId));
    log("browser_recording_discarded", { agentId: recording.agentId, recordingId });
    return { ok: true, value: null };
  }

  async stop(userId: string, recordingId: string): Promise<Outcome<{ done: Promise<void> }>> {
    const recording = await this.ownedRecording(userId, recordingId);
    if (!recording) return refuse(404, "recording_not_found");
    if (recording.status !== "recording") return refuse(409, "recording_closed");
    const [closed] = await getDb()
      .update(schema.recordings)
      .set({ status: "processing", stoppedAt: new Date() })
      .where(and(eq(schema.recordings.id, recordingId), eq(schema.recordings.status, "recording")))
      .returning({ id: schema.recordings.id });
    if (!closed) return refuse(409, "recording_closed");
    this.hub.broadcast(recording.agentId, { type: "recording", recordingId, status: "processing" });
    const done = this.finish(recording.agentId, recordingId).catch(async (error) => {
      log("browser_recording_error", { agentId: recording.agentId, recordingId, error: String(error) });
      await this.fail(recording.agentId, recordingId, String((error as Error).message ?? error));
    });
    return { ok: true, value: { done } };
  }

  async status(userId: string, recordingId: string) {
    const [row] = await getDb()
      .select({ recording: schema.recordings, ownerId: schema.agents.ownerId })
      .from(schema.recordings)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.recordings.agentId))
      .where(eq(schema.recordings.id, recordingId));
    if (!row || row.ownerId !== userId || row.recording.source !== "browser") return null;
    const [recipe] = await getDb().select({ id: schema.recipes.id }).from(schema.recipes).where(eq(schema.recipes.recordingId, recordingId));
    return { status: row.recording.status, agentId: row.recording.agentId, recipeId: recipe?.id ?? null };
  }

  private async transcribe(agentId: string, recordingId: string) {
    const db = getDb();
    const clips = await db
      .select()
      .from(schema.recordingAudio)
      .where(eq(schema.recordingAudio.recordingId, recordingId))
      .orderBy(asc(schema.recordingAudio.startedAt));
    if (!clips.length) return [];
    const transcriber = this.transcriber();
    const narration: RecordedEvent[] = [];
    let failed = 0;
    try {
      if (!transcriber) {
        await this.hub.addMessage(agentId, "system", copy.extension.noTranscriber);
        return [];
      }
      for (const clip of clips) {
        try {
          const transcript = await transcriber.transcribe(Buffer.from(clip.audio), clip.mediaType);
          narration.push(...narrationFromTranscript(clip.startedAt, transcript));
        } catch (error) {
          failed += 1;
          log("transcription_failed", { agentId, recordingId, transcriber: transcriber.name, error: String(error) });
        }
      }
      if (failed) await this.hub.addMessage(agentId, "system", copy.extension.transcriptionFailed(failed, clips.length));
      log("transcribed", { agentId, recordingId, clips: clips.length, failed, lines: narration.length, transcriber: transcriber.name });
      return narration;
    } finally {
      await db.delete(schema.recordingAudio).where(eq(schema.recordingAudio.recordingId, recordingId));
    }
  }

  private async finish(agentId: string, recordingId: string) {
    const narration = await this.transcribe(agentId, recordingId);
    const db = getDb();
    const stored = await db
      .select({ seq: schema.recordedEvents.seq, event: schema.recordedEvents.event })
      .from(schema.recordedEvents)
      .where(eq(schema.recordedEvents.recordingId, recordingId))
      .orderBy(asc(schema.recordedEvents.seq));
    if (narration.length) {
      const last = stored.at(-1)?.seq ?? 0;
      const rows = narration.map((event, index) => ({ id: newId("evt"), recordingId, seq: last + index + 1, event }));
      await db.insert(schema.recordedEvents).values(rows);
      for (const row of rows) this.hub.broadcast(agentId, { type: "recorded", recordingId, seq: row.seq, event: row.event });
    }
    const timeline = mergeTimeline(
      stored.map((row) => row.event),
      narration,
    );
    if (!timeline.length) {
      await this.fail(agentId, recordingId, copy.extension.nothingRecorded);
      return;
    }
    const result = await this.hub.deliver(agentId, { type: "teach_recording", recordingId, events: timeline, ownerBrowser: true }, { source: "panel" });
    log("browser_recording_sent", { agentId, recordingId, events: timeline.length, status: result.status });
    if (result.status === "queued") await this.hub.addMessage(agentId, "system", result.starting ? copy.live.startingQueued : copy.live.queued);
  }

  private async fail(agentId: string, recordingId: string, error: string) {
    await this.hub.recordings.fail(agentId, recordingId);
    this.hub.broadcast(agentId, { type: "recording", recordingId, status: "failed" });
    this.hub.broadcast(agentId, { type: "recipe_failed", recordingId, error });
  }
}
