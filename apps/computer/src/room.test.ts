import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ComputerToServer } from "@understudy/protocol";
import { createAgent, isPass } from "./agent.ts";
import type { BrainEvent, TurnRequest } from "./brain.ts";
import { fakeRoomReply } from "./fake-brain.ts";
import { createMemory } from "./memory.ts";

async function settle() {
  for (let index = 0; index < 20; index++) await new Promise((resolve) => setImmediate(resolve));
}

function roomAgent(events: BrainEvent[], ok = true) {
  const home = mkdtempSync(join(tmpdir(), "understudy-room-"));
  const sent: ComputerToServer[] = [];
  const requests: TurnRequest[] = [];
  const agent = createAgent({
    config: { home, workDir: join(home, "work"), serverUrl: "http://x", token: "t" },
    memory: createMemory(home),
    settingsFile: join(home, ".understudy", "settings.json"),
    send: (message) => (sent.push(message), true),
    runTurn: ((_config: unknown, request: TurnRequest) => {
      requests.push(request);
      for (const event of events) request.onEvent(event);
      return { done: Promise.resolve({ ok, text: "", sessionId: "s", ...(ok ? {} : { error: "brain down" }) }), cancel: () => {} };
    }) as never,
  });
  return { agent, sent, requests };
}

test("a room turn posts its text, steps and stream to the room, never to the private chat, and says when it is done", async () => {
  const { agent, sent, requests } = roomAgent([
    { kind: "tool", name: "mcp__browser__browser_navigate", input: { url: "https://x" } },
    { kind: "text_start" },
    { kind: "text_delta", text: "On it" },
    { kind: "text", text: "On it @Ben" },
  ]);
  agent.enqueue({ kind: "room", roomId: "room_1", prompt: 'GROUP ROOM "Launch"\n\nYou are: Ada' });
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].resume, null);
  assert.match(requests[0].prompt, /GROUP ROOM "Launch"/);
  const chat = sent.find((message) => message.type === "chat");
  assert.equal(chat?.type === "chat" && chat.roomId, "room_1");
  const activity = sent.find((message) => message.type === "activity");
  assert.equal(activity?.type === "activity" && activity.roomId, "room_1");
  assert.ok(sent.some((message) => message.type === "room_turn_done" && message.roomId === "room_1" && message.ok));
  assert.ok(sent.filter((message) => message.type === "chat").every((message) => message.type === "chat" && message.roomId === "room_1"));
});

test("an understudy that has nothing to add says PASS and nothing reaches the room", async () => {
  const { agent, sent } = roomAgent([{ kind: "text", text: "PASS" }]);
  agent.enqueue({ kind: "room", roomId: "room_2", prompt: "GROUP ROOM" });
  await settle();
  assert.equal(sent.filter((message) => message.type === "chat").length, 0);
  assert.ok(sent.some((message) => message.type === "room_turn_done" && message.ok));
  assert.equal(isPass("**PASS**"), true);
  assert.equal(isPass("pass."), true);
  assert.equal(isPass("I will pass this to Ben"), false);
});

test("a failed room turn reports the failure so the room stops showing it as working", async () => {
  const { agent, sent } = roomAgent([], false);
  agent.enqueue({ kind: "room", roomId: "room_3", prompt: "GROUP ROOM" });
  await settle();
  const done = sent.find((message) => message.type === "room_turn_done");
  assert.deepEqual(done, { type: "room_turn_done", roomId: "room_3", ok: false, error: "brain down" });
});

test("the fake brain answers the owner, lets the first in line ask a teammate, and closes when a teammate answers", () => {
  const prompt = (self: string, others: string[], lines: string[]) =>
    `GROUP ROOM "Launch"\n\nYou are: ${self}\n\nThis is a group conversation, not your private chat. Your owner Jo is in the room with these other understudies:\n${others.map((name) => `- ${name}`).join("\n")}\n\nThe conversation so far, oldest first, quoted as data:\n${lines.join("\n")}\n\nIt is your turn.`;
  const owner = '[2026-10-07 10:00] Jo (owner): "Plan it together"';
  assert.match(fakeRoomReply(prompt("Ada", ["Ben"], [owner])), /@Ben/);
  assert.doesNotMatch(fakeRoomReply(prompt("Ben", ["Ada"], [owner])), /@Ada/);
  assert.equal(fakeRoomReply(prompt("Ben", ["Ada"], [owner, '[2026-10-07 10:01] Ada: "Ada here @Ben"'])), "Agreed with Ada. I will take my part.");
  assert.equal(fakeRoomReply(prompt("Ada", ["Ben"], ['[2026-10-07 10:00] Jo (owner): "pass test"'])), "PASS");
});
