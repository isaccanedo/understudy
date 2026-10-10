import { CLIP_MS } from "./logic.ts";
import type { OffscreenCommand, OffscreenReport, Reply } from "./types.ts";

type Upload = { serverUrl: string; token: string; recordingId: string };

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let target: Upload | null = null;
let clipStartedAt = 0;
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let levelTimer: ReturnType<typeof setInterval> | null = null;
let audioContext: AudioContext | null = null;
let failed = 0;
const uploads = new Set<Promise<void>>();

function report(message: OffscreenReport) {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function mimeType() {
  for (const candidate of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

async function upload(blob: Blob, startedAt: number) {
  if (!target || !blob.size) return;
  const { serverUrl, token, recordingId } = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/api/extension/recordings/${recordingId}/audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type.split(";")[0] || "audio/webm", "X-Started-At": String(startedAt) },
        body: blob,
      });
      if (response.ok) return;
      if (response.status < 500 && response.status !== 429) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  failed += 1;
  report({ type: "audio-problem", error: "audio_upload_failed" });
}

function beginClip() {
  if (!stream) return;
  const chunks: Blob[] = [];
  const type = mimeType();
  const current = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
  const startedAt = Date.now();
  current.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  current.addEventListener("stop", () => {
    const pending = upload(new Blob(chunks, { type: current.mimeType || type || "audio/webm" }), startedAt);
    uploads.add(pending);
    void pending.finally(() => uploads.delete(pending));
  });
  current.start(1000);
  recorder = current;
  clipStartedAt = startedAt;
  rotateTimer = setTimeout(() => {
    endClip();
    beginClip();
  }, CLIP_MS);
}

function endClip() {
  if (rotateTimer) clearTimeout(rotateTimer);
  rotateTimer = null;
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
}

function watchLevel(source: MediaStream) {
  audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(source).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  levelTimer = setInterval(() => {
    if (!recorder) return report({ type: "audio-level", level: 0 });
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
    report({ type: "audio-level", level: Math.min(1, Math.sqrt(sum / samples.length) * 4) });
  }, 200);
}

async function start(next: Upload): Promise<Reply<null>> {
  if (stream) await stop();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    const name = (error as DOMException).name;
    return { ok: false, error: name === "NotAllowedError" ? "mic_denied" : name === "NotFoundError" ? "mic_missing" : "mic_failed" };
  }
  target = next;
  failed = 0;
  watchLevel(stream);
  beginClip();
  return { ok: true, value: null };
}

async function stop(): Promise<Reply<{ failed: number }>> {
  endClip();
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  await new Promise((resolve) => setTimeout(resolve, 50));
  await Promise.all([...uploads]);
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  await audioContext?.close().catch(() => undefined);
  audioContext = null;
  target = null;
  return { ok: true, value: { failed } };
}

async function handle(message: OffscreenCommand): Promise<Reply<unknown>> {
  switch (message.type) {
    case "audio-start":
      return start({ serverUrl: message.serverUrl, token: message.token, recordingId: message.recordingId });
    case "audio-pause":
      endClip();
      return { ok: true, value: null };
    case "audio-resume":
      if (stream && !recorder) beginClip();
      return { ok: true, value: { clipStartedAt } };
    case "audio-stop":
      return stop();
  }
}

chrome.runtime.onMessage.addListener((message: OffscreenCommand, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  handle(message).then(sendResponse, (error) => sendResponse({ ok: false, error: String((error as Error).message ?? error) }));
  return true;
});
