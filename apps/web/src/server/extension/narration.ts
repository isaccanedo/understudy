import type { RecordedEvent } from "@understudy/protocol";

export type TranscriptSegment = { start: number; end: number; text: string };

export type Transcript = { text: string; segments: TranscriptSegment[]; durationSeconds?: number };

type Narration = Extract<RecordedEvent, { kind: "narration" }>;

const MAX_NARRATION_CHARS = 4000;

export function splitSentences(text: string) {
  return (text.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? [])
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function narrationFromTranscript(clipStartedAt: number, transcript: Transcript): Narration[] {
  const segments = transcript.segments
    .map((segment) => ({ start: Math.max(0, segment.start), end: Math.max(segment.start, segment.end), text: segment.text.replace(/\s+/g, " ").trim() }))
    .filter((segment) => segment.text);
  if (segments.length) {
    return segments
      .sort((a, b) => a.start - b.start)
      .map((segment) => ({ kind: "narration", at: Math.round(clipStartedAt + segment.start * 1000), text: segment.text.slice(0, MAX_NARRATION_CHARS) }));
  }
  const sentences = splitSentences(transcript.text);
  if (!sentences.length) return [];
  const duration = transcript.durationSeconds && transcript.durationSeconds > 0 ? transcript.durationSeconds : 0;
  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  let before = 0;
  return sentences.map((sentence) => {
    const at = Math.round(clipStartedAt + (duration * 1000 * before) / total);
    before += sentence.length;
    return { kind: "narration", at, text: sentence.slice(0, MAX_NARRATION_CHARS) };
  });
}

export function mergeTimeline(events: RecordedEvent[], narration: RecordedEvent[]): RecordedEvent[] {
  const order = (event: RecordedEvent) => (event.kind === "narration" ? 0 : 1);
  return [...events, ...narration]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.at - b.event.at || order(a.event) - order(b.event) || a.index - b.index)
    .map(({ event }) => event);
}
