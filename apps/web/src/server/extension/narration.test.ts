import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecordedEvent } from "@understudy/protocol";
import { mergeTimeline, narrationFromTranscript, splitSentences } from "./narration";

test("segments land at the clip start plus their offset", () => {
  const narration = narrationFromTranscript(1_000_000, {
    text: "First I open the bank. Then I download the statement.",
    segments: [
      { start: 4.2, end: 6, text: " Then I download the statement. " },
      { start: 0.5, end: 3.9, text: "First I open the bank." },
      { start: 7, end: 8, text: "   " },
    ],
  });
  assert.deepEqual(narration, [
    { kind: "narration", at: 1_000_500, text: "First I open the bank." },
    { kind: "narration", at: 1_004_200, text: "Then I download the statement." },
  ]);
});

test("without segments the sentences are spread over the clip by length", () => {
  const narration = narrationFromTranscript(10_000, { text: "Open it. Now click export please.", segments: [], durationSeconds: 10 });
  assert.equal(narration.length, 2);
  assert.equal(narration[0].at, 10_000);
  assert.ok(narration[1].at > 10_000 && narration[1].at < 20_000);
  assert.deepEqual(narrationFromTranscript(0, { text: "  ", segments: [] }), []);
  assert.deepEqual(splitSentences("Is it paid? Yes! Then send it"), ["Is it paid?", "Yes!", "Then send it"]);
});

test("narration interleaves with the steps it explains, and talk comes before a step at the same moment", () => {
  const click: RecordedEvent = { kind: "click", at: 2_000, url: "https://a", selector: "#export", label: "Export", x: 1, y: 1 };
  const open: RecordedEvent = { kind: "navigate", at: 1_000, url: "https://a" };
  const said: RecordedEvent = { kind: "narration", at: 2_000, text: "I export because finance needs the CSV" };
  const later: RecordedEvent = { kind: "narration", at: 5_000, text: "and that is it" };
  assert.deepEqual(mergeTimeline([open, click], [later, said]), [open, said, click, later]);
});

test("a pause between clips keeps each clip on its own clock", () => {
  const first = narrationFromTranscript(1_000, { text: "", segments: [{ start: 1, end: 2, text: "before the pause" }] });
  const second = narrationFromTranscript(60_000, { text: "", segments: [{ start: 1, end: 2, text: "after the pause" }] });
  const step: RecordedEvent = { kind: "click", at: 30_000, url: "https://a", selector: "#b", label: "B", x: 0, y: 0 };
  assert.deepEqual(mergeTimeline([step], [...second, ...first]).map((event) => event.at), [2_000, 30_000, 61_000]);
});
