import type { RecordedEvent } from "@understudy/protocol";
import { parseCaptured, sanitizeRequestUrl } from "@understudy/protocol/capture";
import { apiError, EventBuffer, fromIndicator, idleSession, isRecordableUrl, lastNavigation, normalizeServerUrl } from "./logic.ts";
import type { Agent, ContentCommand, ContentRequest, OffscreenCommand, OffscreenReport, Pairing, PopupRequest, Reply, Session, Status } from "./types.ts";

const CONTENT_SCRIPT_ID = "understudy-capture";
const OFFSCREEN_PATH = "offscreen.html";
const FLUSH_MS = 1500;
const POLL_MS = 3000;

let config = { serverUrl: "", productName: "Understudy" };
let session: Session = idleSession();
let level = 0;
let ready: Promise<void> | null = null;
const buffer = new EventBuffer<RecordedEvent>();
const navigation = lastNavigation();
let flushing = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function loadConfig() {
  try {
    const response = await fetch(chrome.runtime.getURL("config.json"));
    if (response.ok) {
      const loaded = (await response.json()) as { serverUrl?: string; productName?: string };
      config = { serverUrl: normalizeServerUrl(loaded.serverUrl ?? "") ?? "", productName: loaded.productName?.trim() || "Understudy" };
    }
  } catch {}
}

function init() {
  ready ??= (async () => {
    await loadConfig();
    const stored = await chrome.storage.session.get("session");
    if (stored.session) session = stored.session as Session;
    if (session.phase === "recording" || session.phase === "paused") startFlushing();
    if (session.phase === "processing") schedulePoll();
    await paintBadge();
  })();
  return ready;
}

async function pairing(): Promise<Pairing | null> {
  const stored = await chrome.storage.local.get("pairing");
  return (stored.pairing as Pairing | undefined) ?? null;
}

async function save(next: Partial<Session>) {
  session = { ...session, ...next };
  await chrome.storage.session.set({ session });
  await paintBadge();
}

async function paintBadge() {
  const recording = session.phase === "recording";
  const paused = session.phase === "paused";
  await chrome.action.setBadgeText({ text: recording ? "REC" : paused ? "II" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: recording ? "#ff6363" : "#f2b45a" });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: recording ? "#ffffff" : "#0b0c10" });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<Reply<T>> {
  const paired = await pairing();
  if (!paired) return { ok: false, error: "not_paired" };
  try {
    const response = await fetch(`${paired.serverUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${paired.token}`, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) await chrome.storage.local.remove("pairing");
      return { ok: false, error: apiError(response.status, body) };
    }
    return { ok: true, value: body as T };
  } catch {
    return { ok: false, error: "offline" };
  }
}

async function status(): Promise<Status> {
  await init();
  const paired = await pairing();
  return {
    config,
    pairing: paired ? { serverUrl: paired.serverUrl, userName: paired.userName, userEmail: paired.userEmail, productName: paired.productName } : null,
    session,
    level,
  };
}

async function pair(serverUrlInput: string, code: string): Promise<Reply<null>> {
  const serverUrl = normalizeServerUrl(serverUrlInput);
  if (!serverUrl) return { ok: false, error: "invalid_server" };
  try {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
    const response = await fetch(`${serverUrl}/api/extension/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, label: `Chrome${platform ? ` on ${platform}` : ""}` }),
    });
    const body = (await response.json().catch(() => ({}))) as { token?: string; user?: { name: string; email: string }; productName?: string };
    if (!response.ok || !body.token || !body.user) return { ok: false, error: apiError(response.status, body) };
    const stored: Pairing = { serverUrl, token: body.token, userName: body.user.name, userEmail: body.user.email, productName: body.productName || config.productName };
    await chrome.storage.local.set({ pairing: stored });
    return { ok: true, value: null };
  } catch {
    return { ok: false, error: "offline" };
  }
}

async function unpair(): Promise<Reply<null>> {
  if (session.phase === "recording" || session.phase === "paused") await discard();
  await api("/api/extension/me", { method: "DELETE" });
  await chrome.storage.local.remove("pairing");
  await save(idleSession());
  return { ok: true, value: null };
}

async function tellTabs(command: ContentCommand) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? null : chrome.tabs.sendMessage(tab.id, command).catch(() => null))));
}

function command(): ContentCommand {
  const on = session.phase === "recording";
  return { type: "recorder", on, paused: session.phase === "paused", ended: !on && session.phase !== "paused", agentName: session.agentName };
}

async function attachContentScript() {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([{ id: CONTENT_SCRIPT_ID, js: ["content.js"], matches: ["http://*/*", "https://*/*"], runAt: "document_start", persistAcrossSessions: false }]);
  }
  const paired = await pairing();
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && isRecordableUrl(tab.url, paired?.serverUrl))
      .map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id as number }, files: ["content.js"] }).catch(() => null)),
  );
}

async function detachContentScript() {
  await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => null);
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Record the owner's voice while they teach a task",
  });
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) await chrome.offscreen.closeDocument().catch(() => null);
  level = 0;
}

async function toOffscreen<T>(message: OffscreenCommand): Promise<Reply<T>> {
  try {
    return ((await chrome.runtime.sendMessage(message)) as Reply<T> | undefined) ?? { ok: false, error: "no_answer" };
  } catch (error) {
    return { ok: false, error: String((error as Error).message ?? error) };
  }
}

function record(event: RecordedEvent) {
  if (session.phase !== "recording") return;
  if (buffer.push(event)) session = { ...session, events: session.events + 1 };
}

async function flush() {
  if (flushing || !session.recordingId || !buffer.size) return;
  flushing = true;
  try {
    while (buffer.size && session.recordingId) {
      const batch = buffer.take();
      const result = await api<{ accepted: number }>(`/api/extension/recordings/${session.recordingId}/events`, { method: "POST", body: JSON.stringify({ events: batch }) });
      if (!result.ok) {
        if (result.error === "recording_closed" || result.error === "recording_not_found") buffer.clear();
        break;
      }
      buffer.drop(batch.length);
    }
    await chrome.storage.session.set({ session });
  } finally {
    flushing = false;
  }
}

function startFlushing() {
  if (flushTimer) return;
  flushTimer = setInterval(() => void flush(), FLUSH_MS);
}

function stopFlushing() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

async function noteActiveTab(tabId: number) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const paired = await pairing();
  if (!tab || !isRecordableUrl(tab.url, paired?.serverUrl)) return;
  const url = sanitizeRequestUrl(tab.url as string);
  if (!navigation.changed(tabId, url)) return;
  record({ kind: "navigate", at: Date.now(), url, ...(tab.title ? { title: tab.title.slice(0, 300) } : {}) });
}

async function start(agentId: string, voice: boolean): Promise<Reply<null>> {
  if (session.phase === "recording" || session.phase === "paused" || session.phase === "starting" || session.phase === "finishing") return { ok: false, error: "busy" };
  const agents = await api<{ agents: Agent[] }>("/api/extension/me");
  if (!agents.ok) return agents;
  const agent = agents.value.agents.find((item) => item.id === agentId);
  if (!agent) return { ok: false, error: "agent_not_found" };
  await save({ ...idleSession(), phase: "starting", agentId, agentName: agent.name, voice });
  const created = await api<{ recordingId: string }>("/api/extension/recordings", { method: "POST", body: JSON.stringify({ agentId }) });
  if (!created.ok) {
    await save({ ...idleSession(), error: created.error });
    return created;
  }
  const paired = (await pairing()) as Pairing;
  buffer.clear();
  navigation.clear();
  if (voice) {
    await ensureOffscreen();
    const audio = await toOffscreen<null>({ target: "offscreen", type: "audio-start", serverUrl: paired.serverUrl, token: paired.token, recordingId: created.value.recordingId });
    if (!audio.ok) {
      await closeOffscreen();
      await api(`/api/extension/recordings/${created.value.recordingId}`, { method: "DELETE" });
      await save({ ...idleSession(), error: audio.error });
      return audio;
    }
  }
  await save({ phase: "recording", recordingId: created.value.recordingId, startedAt: Date.now(), pausedAt: null, pausedMs: 0, events: 0, error: null });
  await attachContentScript();
  await tellTabs(command());
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id !== undefined) await noteActiveTab(active.id);
  startFlushing();
  return { ok: true, value: null };
}

async function pause(): Promise<Reply<null>> {
  if (session.phase !== "recording") return { ok: false, error: "not_recording" };
  await save({ phase: "paused", pausedAt: Date.now() });
  if (session.voice) await toOffscreen({ target: "offscreen", type: "audio-pause" });
  await tellTabs(command());
  await flush();
  return { ok: true, value: null };
}

async function resume(): Promise<Reply<null>> {
  if (session.phase !== "paused") return { ok: false, error: "not_paused" };
  const pausedFor = session.pausedAt ? Date.now() - session.pausedAt : 0;
  await save({ phase: "recording", pausedAt: null, pausedMs: session.pausedMs + pausedFor });
  if (session.voice) await toOffscreen({ target: "offscreen", type: "audio-resume" });
  await tellTabs(command());
  return { ok: true, value: null };
}

async function stop(): Promise<Reply<null>> {
  if (session.phase !== "recording" && session.phase !== "paused") return { ok: false, error: "not_recording" };
  const pausedFor = session.pausedAt ? Date.now() - session.pausedAt : 0;
  await save({ phase: "finishing", pausedAt: null, pausedMs: session.pausedMs + pausedFor });
  await tellTabs(command());
  await detachContentScript();
  stopFlushing();
  await flush();
  if (session.voice) {
    const audio = await toOffscreen<{ failed: number }>({ target: "offscreen", type: "audio-stop" });
    await closeOffscreen();
    if (!audio.ok) await save({ error: audio.error });
  }
  const stopped = await api(`/api/extension/recordings/${session.recordingId}/stop`, { method: "POST" });
  if (!stopped.ok) {
    await save({ phase: "failed", error: stopped.error });
    return stopped;
  }
  await save({ phase: "processing" });
  schedulePoll();
  return { ok: true, value: null };
}

async function discard(): Promise<Reply<null>> {
  const recordingId = session.recordingId;
  await save({ phase: "finishing" });
  await tellTabs({ type: "recorder", on: false, paused: false, ended: true, agentName: null });
  await detachContentScript();
  stopFlushing();
  buffer.clear();
  if (session.voice) {
    await toOffscreen({ target: "offscreen", type: "audio-stop" });
    await closeOffscreen();
  }
  if (recordingId) await api(`/api/extension/recordings/${recordingId}`, { method: "DELETE" });
  await save(idleSession());
  return { ok: true, value: null };
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(), POLL_MS);
}

async function poll() {
  pollTimer = null;
  if (session.phase !== "processing" || !session.recordingId) return;
  const result = await api<{ status: string; recipeId: string | null }>(`/api/extension/recordings/${session.recordingId}`);
  if (result.ok && result.value.status === "done" && result.value.recipeId) return save({ phase: "done", recipeId: result.value.recipeId });
  if (result.ok && result.value.status === "failed") return save({ phase: "failed", error: "recipe_failed" });
  if (!result.ok && result.error === "recording_not_found") return save({ phase: "failed", error: result.error });
  schedulePoll();
}

async function onPopup(request: PopupRequest): Promise<Reply<unknown>> {
  await init();
  switch (request.type) {
    case "status":
      if (session.phase === "processing" && !pollTimer) schedulePoll();
      return { ok: true, value: await status() };
    case "pair":
      return pair(request.serverUrl, request.code);
    case "unpair":
      return unpair();
    case "agents": {
      const result = await api<{ agents: Agent[] }>("/api/extension/me");
      return result.ok ? { ok: true, value: result.value.agents } : result;
    }
    case "start":
      return start(request.agentId, request.voice);
    case "pause":
      return pause();
    case "resume":
      return resume();
    case "stop":
      return stop();
    case "discard":
      return discard();
    case "reset":
      if (session.phase === "done" || session.phase === "failed" || session.phase === "idle" || session.phase === "processing") await save(idleSession());
      return { ok: true, value: null };
  }
}

async function onContent(request: ContentRequest, sender: chrome.runtime.MessageSender): Promise<Reply<unknown>> {
  await init();
  switch (request.type) {
    case "hello": {
      const paired = await pairing();
      return { ok: true, value: { ...command(), serverUrl: paired?.serverUrl ?? "", productName: paired?.productName ?? config.productName } };
    }
    case "captured": {
      if (session.phase !== "recording" || fromIndicator(request.payload)) return { ok: true, value: null };
      const paired = await pairing();
      if (!isRecordableUrl(sender.tab?.url ?? sender.url, paired?.serverUrl)) return { ok: true, value: null };
      const event = parseCaptured(request.payload);
      if (event) record(event);
      return { ok: true, value: null };
    }
    case "indicator":
      if (request.action === "pause") return pause();
      if (request.action === "resume") return resume();
      return stop();
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string; target?: string }, sender, sendResponse) => {
  if (message.target === "offscreen") return false;
  if (message.type === "audio-level") {
    level = (message as Extract<OffscreenReport, { type: "audio-level" }>).level;
    return false;
  }
  if (message.type === "audio-problem") {
    void save({ error: (message as Extract<OffscreenReport, { type: "audio-problem" }>).error });
    return false;
  }
  const fromExtension = sender.id === chrome.runtime.id && (sender.url ?? "").startsWith(chrome.runtime.getURL(""));
  const work = fromExtension ? onPopup(message as PopupRequest) : onContent(message as ContentRequest, sender);
  work.then(sendResponse, (error) => sendResponse({ ok: false, error: String((error as Error).message ?? error) }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "complete" || !tab.active) return;
  void init().then(() => (session.phase === "recording" ? noteActiveTab(tabId) : undefined));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void init().then(() => (session.phase === "recording" ? noteActiveTab(tabId) : undefined));
});

chrome.tabs.onRemoved.addListener((tabId) => navigation.forget(tabId));

chrome.runtime.onStartup.addListener(() => void init());
chrome.runtime.onInstalled.addListener(() => void init());
void init();
