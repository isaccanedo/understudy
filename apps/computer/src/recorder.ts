import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Frame, Page } from "playwright-core";
import { parseCaptured, sanitizeRequestUrl, type ComputerToServer, type RecordedEvent } from "@understudy/protocol";
import type { BrowserHandle } from "./browser.ts";
import { captureScript, RECORD_BINDING, RECORDER_SWITCH } from "./capture-script.ts";
import { log } from "@understudy/runtime";

type Attachment = {
  page: Page;
  session: CDPSession;
  scriptId: string;
  detach: () => Promise<void>;
};

type Recording = {
  id: string;
  dir: string;
  events: RecordedEvent[];
  attachments: Map<Page, Attachment>;
};

export type Recorder = {
  start: (recordingId: string) => Promise<void>;
  narrate: (recordingId: string, text: string) => void;
  stop: (recordingId: string) => Promise<RecordedEvent[] | null>;
  activeId: () => string | null;
};

export { looksSensitiveValue, MASK, parseCaptured, passesLuhn, sanitizeRequestUrl, shouldMask } from "@understudy/protocol";

const TRACKED_TYPES = new Set(["XHR", "Fetch"]);

export function createRecorder(options: {
  browser: BrowserHandle;
  send: (message: ComputerToServer) => boolean;
  baseDir: string;
  onActiveChange: (recording: boolean) => void;
}): Recorder {
  let current: Recording | null = null;

  const record = (recording: Recording, event: RecordedEvent) => {
    if (current !== recording) return;
    recording.events.push(event);
    const stored = event.kind === "screenshot" ? { kind: "screenshot", at: event.at, file: `${event.at}.jpg` } : event;
    if (event.kind === "screenshot") writeFileSync(join(recording.dir, `${event.at}.jpg`), Buffer.from(event.jpegBase64, "base64"));
    appendFileSync(join(recording.dir, "events.jsonl"), `${JSON.stringify(stored)}\n`);
    options.send({ type: "recorded", recordingId: recording.id, event });
  };

  const screenshot = async (recording: Recording, session: CDPSession) => {
    try {
      const shot = (await session.send("Page.captureScreenshot", { format: "jpeg", quality: 50 })) as { data: string };
      record(recording, { kind: "screenshot", at: Date.now(), jpegBase64: shot.data });
    } catch (error) {
      log("recorder", `screenshot failed: ${(error as Error).message}`);
    }
  };

  const attach = async (recording: Recording, page: Page, session: CDPSession) => {
    if (recording.attachments.has(page) || page.isClosed()) return;
    const requests = new Map<string, { method: string; url: string }>();
    let lastNavigated = "";

    const onBinding = (params: { name: string; payload: string }) => {
      if (params.name !== RECORD_BINDING) return;
      const event = parseCaptured(params.payload);
      if (!event) return;
      record(recording, event);
      if (event.kind === "click") void screenshot(recording, session);
    };
    const onRequest = (params: { requestId: string; type?: string; request: { method: string; url: string } }) => {
      if (!params.type || !TRACKED_TYPES.has(params.type)) return;
      requests.set(params.requestId, { method: params.request.method, url: sanitizeRequestUrl(params.request.url) });
    };
    const onResponse = (params: { requestId: string; response: { status: number; mimeType?: string } }) => {
      const request = requests.get(params.requestId);
      if (!request) return;
      requests.delete(params.requestId);
      record(recording, { kind: "request", at: Date.now(), method: request.method, url: request.url, status: params.response.status, contentType: params.response.mimeType });
    };
    const onFailed = (params: { requestId: string }) => {
      const request = requests.get(params.requestId);
      if (!request) return;
      requests.delete(params.requestId);
      record(recording, { kind: "request", at: Date.now(), method: request.method, url: request.url });
    };
    const onNavigated = (frame: Frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (url === lastNavigated || url === "about:blank") return;
      lastNavigated = url;
      setTimeout(() => {
        void page
          .title()
          .catch(() => "")
          .then((title) => record(recording, { kind: "navigate", at: Date.now(), url: sanitizeRequestUrl(url), title: title || undefined }));
      }, 400);
    };

    session.on("Runtime.bindingCalled", onBinding);
    session.on("Network.requestWillBeSent", onRequest as never);
    session.on("Network.responseReceived", onResponse as never);
    session.on("Network.loadingFailed", onFailed as never);
    page.on("framenavigated", onNavigated);

    await session.send("Runtime.enable");
    await session.send("Page.enable");
    await session.send("Network.enable");
    await session.send("Runtime.addBinding", { name: RECORD_BINDING });
    const script = captureScript();
    const added = (await session.send("Page.addScriptToEvaluateOnNewDocument", { source: script })) as { identifier: string };
    await session.send("Runtime.evaluate", { expression: script }).catch(() => {});

    const detach = async () => {
      session.off("Runtime.bindingCalled", onBinding);
      session.off("Network.requestWillBeSent", onRequest as never);
      session.off("Network.responseReceived", onResponse as never);
      session.off("Network.loadingFailed", onFailed as never);
      page.off("framenavigated", onNavigated);
      if (page.isClosed()) return;
      await session.send("Runtime.evaluate", { expression: `window.${RECORDER_SWITCH} = false` }).catch(() => {});
      await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: added.identifier }).catch(() => {});
      await session.send("Runtime.removeBinding", { name: RECORD_BINDING }).catch(() => {});
      await session.send("Network.disable").catch(() => {});
    };

    recording.attachments.set(page, { page, session, scriptId: added.identifier, detach });
    const url = page.url();
    if (url && url !== "about:blank") {
      lastNavigated = url;
      record(recording, { kind: "navigate", at: Date.now(), url: sanitizeRequestUrl(url), title: (await page.title().catch(() => "")) || undefined });
    }
  };

  options.browser.onNewPage(async (page, session) => {
    if (current) await attach(current, page, session).catch((error) => log("recorder", `attach failed: ${error.message}`));
  });

  return {
    async start(recordingId) {
      if (current) await this.stop(current.id);
      const dir = join(options.baseDir, recordingId.replace(/[^a-zA-Z0-9_-]/g, "_"));
      mkdirSync(dir, { recursive: true });
      const recording: Recording = { id: recordingId, dir, events: [], attachments: new Map() };
      current = recording;
      options.onActiveChange(true);
      const active = options.browser.activePage();
      const pages = options.browser.pages().filter((page) => !page.isClosed());
      const ordered = active ? [...pages.filter((page) => page !== active), active] : pages;
      for (const page of ordered) {
        const session = await options.browser.sessionFor(page);
        await attach(recording, page, session).catch((error) => log("recorder", `attach failed: ${error.message}`));
      }
      log("recorder", `recording ${recordingId} on ${recording.attachments.size} page(s)`);
    },
    narrate(recordingId, text) {
      if (!current || current.id !== recordingId) return;
      record(current, { kind: "narration", at: Date.now(), text: text.slice(0, 4000) });
    },
    async stop(recordingId) {
      if (!current || current.id !== recordingId) return null;
      const recording = current;
      for (const attachment of recording.attachments.values()) await attachment.detach();
      current = null;
      options.onActiveChange(false);
      log("recorder", `stopped ${recordingId} with ${recording.events.length} events`);
      return recording.events;
    },
    activeId: () => current?.id ?? null,
  };
}
