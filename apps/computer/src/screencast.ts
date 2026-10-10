import type { CDPSession, Page } from "playwright-core";
import type { ComputerToServer } from "@understudy/protocol";
import type { BrowserHandle } from "./browser.ts";
import { log } from "@understudy/runtime";

const FRAME_INTERVAL_MS = 200;
const MAX_PENDING_BYTES = 4 * 1024 * 1024;

type FrameParams = {
  data: string;
  sessionId: number;
  metadata: { deviceWidth: number; deviceHeight: number };
};

export type Screencast = {
  setViewers: (count: number) => void;
  setRecording: (recording: boolean) => void;
  isRunning: () => boolean;
};

export function shouldStream(viewers: number, recording: boolean): boolean {
  return viewers > 0 || recording;
}

export function startScreencastControl(
  browser: BrowserHandle,
  send: (message: ComputerToServer) => boolean,
  pressure: () => number,
  desktopStream?: { start: () => void; stop: () => void },
): Screencast {
  let viewers = 0;
  let recording = false;
  let running: { page: Page; session: CDPSession; handler: (params: FrameParams) => void } | null = null;
  let lastSentAt = 0;
  let trailing: NodeJS.Timeout | null = null;
  let latest: ComputerToServer | null = null;

  const flush = () => {
    trailing = null;
    if (!latest || !running) return;
    if (pressure() > MAX_PENDING_BYTES) {
      trailing = setTimeout(flush, FRAME_INTERVAL_MS);
      return;
    }
    lastSentAt = Date.now();
    send(latest);
    latest = null;
  };

  const stop = async () => {
    const current = running;
    running = null;
    latest = null;
    if (trailing) clearTimeout(trailing);
    trailing = null;
    if (!current) return;
    current.session.off("Page.screencastFrame", current.handler);
    await current.session.send("Page.stopScreencast").catch(() => {});
  };

  const start = async (page: Page, session: CDPSession) => {
    await stop();
    const handler = (params: FrameParams) => {
      void session.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
      latest = {
        type: "frame",
        jpegBase64: params.data,
        width: params.metadata.deviceWidth,
        height: params.metadata.deviceHeight,
        url: page.url(),
      };
      if (trailing) return;
      const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - lastSentAt));
      if (wait === 0 && pressure() <= MAX_PENDING_BYTES) flush();
      else trailing = setTimeout(flush, wait || FRAME_INTERVAL_MS);
    };
    running = { page, session, handler };
    session.on("Page.screencastFrame", handler);
    await session.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
    await sendStill(page, session);
  };

  const sendStill = async (page: Page, session: CDPSession) => {
    try {
      const shot = (await session.send("Page.captureScreenshot", { format: "jpeg", quality: 60 })) as { data: string };
      const size = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
      send({ type: "frame", jpegBase64: shot.data, width: size.width, height: size.height, url: page.url() });
    } catch (error) {
      log("screencast", `still frame failed: ${(error as Error).message}`);
    }
  };

  const reconcile = async () => {
    if (desktopStream) {
      if (shouldStream(viewers, recording)) desktopStream.start();
      else desktopStream.stop();
      return;
    }
    const page = browser.activePage();
    const session = browser.activeSession();
    if (!shouldStream(viewers, recording) || !page || !session) {
      await stop();
      return;
    }
    if (running?.page === page) return;
    await start(page, session);
  };

  browser.onActiveChange(() => reconcile().catch((error) => log("screencast", error.message)));

  return {
    setViewers(count) {
      const previous = viewers;
      viewers = Math.max(0, count);
      if (running && viewers > previous) void sendStill(running.page, running.session);
      void reconcile().catch((error) => log("screencast", error.message));
    },
    setRecording(value) {
      recording = value;
      void reconcile().catch((error) => log("screencast", error.message));
    },
    isRunning: () => running !== null,
  };
}
