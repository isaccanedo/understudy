import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extensionFolderName } from "@/lib/extension-folder";
import { audioMediaType, cleanBrowserEvents, MAX_EVENTS_PER_BATCH } from "./browser-recordings";
import { customizeManifest } from "./package";
import { newPairCode, normalizePairCode, PAIR_CODE_ALPHABET } from "./pairing";
import { corsHeaders } from "./routes";
import { fakeTranscriber, gatewayTranscriber, openAiTranscriber, transcriberFromEnv } from "./transcriber";
import { zip } from "./zip";

test("pairing codes are short, unambiguous and forgiving to type", () => {
  for (let i = 0; i < 50; i++) {
    const code = newPairCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    for (const char of code.replace("-", "")) assert.ok(PAIR_CODE_ALPHABET.includes(char));
  }
  assert.equal(normalizePairCode(" abcd efgh "), "ABCD-EFGH");
  assert.equal(normalizePairCode("ABCD-EFGH"), "ABCD-EFGH");
  assert.equal(normalizePairCode("ABCD-EFG0"), null);
  assert.equal(normalizePairCode("ABC"), null);
});

test("only extension origins get CORS headers", () => {
  assert.equal(corsHeaders("chrome-extension://abcdefghijklmnopabcdefghijklmnop")["Access-Control-Allow-Origin"], "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
  assert.deepEqual(corsHeaders("https://evil.example.com"), {});
  assert.deepEqual(corsHeaders(undefined), {});
});

test("uploaded events are validated, capped and re-masked", () => {
  const events = cleanBrowserEvents([
    { kind: "input", at: 1, url: "https://a.com", selector: "#pw", label: "Senha", value: "hunter2", masked: false },
    { kind: "narration", at: 2, text: "forged narration" },
    { kind: "click", at: 3 },
    { kind: "click", at: 4, url: "https://a.com/x?id=9", selector: "#go", label: "Go", x: 1, y: 2 },
  ]);
  assert.deepEqual(events, [
    { kind: "input", at: 1, url: "https://a.com/", selector: "#pw", label: "Senha", value: "••••••", masked: true },
    { kind: "click", at: 4, url: "https://a.com/x?id=…", selector: "#go", label: "Go", x: 1, y: 2 },
  ]);
  assert.equal(cleanBrowserEvents("nope"), null);
  assert.equal(cleanBrowserEvents(Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ({}))), null);
});

test("only audio types the transcriber understands are accepted", () => {
  assert.equal(audioMediaType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(audioMediaType("audio/ogg"), "audio/ogg");
  assert.equal(audioMediaType("text/html"), null);
  assert.equal(audioMediaType(undefined), null);
});

test("the transcriber is chosen by env and never by code", () => {
  assert.equal(transcriberFromEnv({}), null);
  assert.equal(transcriberFromEnv({ UNDERSTUDY_TRANSCRIBER: "fake" })?.name, "fake");
  assert.equal(transcriberFromEnv({ AI_GATEWAY_API_KEY: "k" })?.name, "gateway:openai/whisper-1");
  assert.equal(transcriberFromEnv({ UNDERSTUDY_TRANSCRIBER: "gateway", UNDERSTUDY_TRANSCRIBE_API_KEY: "k", UNDERSTUDY_TRANSCRIBE_MODEL: "openai/gpt-4o-transcribe" })?.name, "gateway:openai/gpt-4o-transcribe");
  assert.equal(transcriberFromEnv({ UNDERSTUDY_TRANSCRIBER: "openai", UNDERSTUDY_TRANSCRIBE_API_KEY: "k" })?.name, "openai:whisper-1");
  assert.equal(transcriberFromEnv({ UNDERSTUDY_TRANSCRIBER: "openai" }), null);
  assert.equal(transcriberFromEnv({ UNDERSTUDY_TRANSCRIBER: "off", AI_GATEWAY_API_KEY: "k" }), null);
});

test("the gateway transcriber sends base64 audio and reads segments", async () => {
  let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  const fetchStub = (async (url: string, init: RequestInit) => {
    seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ text: "hello there", segments: [{ text: "hello there", startSecond: 1.5, endSecond: 2 }], durationInSeconds: 3 }));
  }) as typeof fetch;
  const transcript = await gatewayTranscriber({ apiKey: "key", model: "openai/whisper-1", baseUrl: "https://gw.example.com/", fetch: fetchStub }).transcribe(Buffer.from("abc"), "audio/webm");
  assert.deepEqual(transcript, { text: "hello there", segments: [{ start: 1.5, end: 2, text: "hello there" }], durationSeconds: 3 });
  const request = seen as unknown as { url: string; headers: Record<string, string>; body: Record<string, unknown> };
  assert.equal(request.url, "https://gw.example.com/v4/ai/transcription-model");
  assert.equal(request.headers["ai-model-id"], "openai/whisper-1");
  assert.equal(request.headers.Authorization, "Bearer key");
  assert.deepEqual(request.body, { audio: Buffer.from("abc").toString("base64"), mediaType: "audio/webm" });
});

test("the openai-compatible transcriber asks for segment timestamps and surfaces errors", async () => {
  let form: FormData | null = null;
  const ok = (async (_url: string, init: RequestInit) => {
    form = init.body as FormData;
    return new Response(JSON.stringify({ text: "hi", segments: [{ start: 0, end: 1, text: "hi" }], duration: 1 }));
  }) as typeof fetch;
  const transcript = await openAiTranscriber({ apiKey: "k", model: "whisper-1", baseUrl: "https://api.example.com/v1", fetch: ok }).transcribe(Buffer.from("abc"), "audio/webm");
  assert.equal(transcript.segments[0].text, "hi");
  const sent = form as unknown as FormData;
  assert.equal(sent.get("response_format"), "verbose_json");
  assert.equal(sent.get("timestamp_granularities[]"), "segment");
  const failing = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(openAiTranscriber({ apiKey: "k", model: "whisper-1", baseUrl: "https://api.example.com/v1", fetch: failing }).transcribe(Buffer.from("a"), "audio/webm"), /429: quota/);
  assert.equal((await fakeTranscriber().transcribe(Buffer.alloc(0), "audio/webm")).segments.length, 0);
});

test("the extension zip opens with standard tools and names the product", () => {
  const manifest = customizeManifest(Buffer.from(JSON.stringify({ name: "Understudy", action: { default_popup: "popup.html" } })), "Acme Helper");
  const parsed = JSON.parse(manifest.toString());
  assert.equal(parsed.name, "Acme Helper");
  assert.equal(parsed.action.default_popup, "popup.html");
  assert.equal(parsed.icons["128"], "icons/icon-128.png");
  assert.equal(extensionFolderName("Acme Helper"), "acme-helper-extension");
  assert.equal(extensionFolderName("Ação!"), "acao-extension");
  const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
  const file = path.join(dir, "x.zip");
  const big = Buffer.from("a".repeat(5000));
  writeFileSync(file, zip([{ path: "ext/manifest.json", data: manifest }, { path: "ext/big.txt", data: big }, { path: "ext/empty.txt", data: Buffer.alloc(0) }]));
  const listing = execFileSync("unzip", ["-l", file]).toString();
  assert.match(listing, /ext\/manifest\.json/);
  assert.equal(execFileSync("unzip", ["-p", file, "ext/big.txt"]).toString(), big.toString());
  assert.match(execFileSync("unzip", ["-t", file]).toString(), /No errors detected/);
});
