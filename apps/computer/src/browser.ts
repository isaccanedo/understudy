import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { log } from "@understudy/runtime";
import { PANEL_HEIGHT, SCREEN } from "./desktop.ts";
import { HOME_URL } from "./home.ts";

export const CDP_PORT = 9222;
export const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;
export const VIEWPORT = { width: 1280, height: 800 };

export type PageListener = (page: Page, session: CDPSession) => void | Promise<void>;

export type BrowserHandle = {
  activePage: () => Page | null;
  activeSession: () => CDPSession | null;
  sessionFor: (page: Page) => Promise<CDPSession>;
  onActiveChange: (listener: PageListener) => void;
  onNewPage: (listener: PageListener) => void;
  pages: () => Page[];
  openBackground: () => Promise<Page>;
  close: () => Promise<void>;
};

export const BACKGROUND_MARK = "#understudy-background-";

export function chromiumArgs(profileDir: string, headed = false): string[] {
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--headless=new",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    "--mute-audio",
    "--password-store=basic",
    "--lang=pt-BR",
    "about:blank",
  ];
  if (!headed) return args;
  return [
    ...args.filter((arg) => arg !== "--headless=new" && arg !== "--hide-scrollbars" && arg !== "about:blank" && !arg.startsWith("--window-size=")),
    "--window-position=0,0",
    `--window-size=${SCREEN.width},${SCREEN.height - PANEL_HEIGHT}`,
    "--start-maximized",
    "--keep-alive-for-test",
    "--disable-infobars",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    HOME_URL,
  ];
}

export function openBrowserScript(executable: string, profileDir: string): string {
  return `#!/bin/sh\nexec "${executable}" --no-sandbox --user-data-dir="${profileDir}" --new-window "$@"\n`;
}

export async function launchBrowser(profileDir: string, desktopEnv?: NodeJS.ProcessEnv): Promise<BrowserHandle> {
  mkdirSync(profileDir, { recursive: true });
  for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(join(profileDir, lock), { force: true });
  const executable = process.env.CHROMIUM_PATH || chromium.executablePath();
  if (desktopEnv?.HOME) {
    const bin = join(desktopEnv.HOME, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "open-browser"), openBrowserScript(executable, profileDir), { mode: 0o755 });
  }
  let child: ChildProcess | null = null;
  let stopping = false;

  const start = () => {
    log("browser", `starting ${executable}`);
    const started = spawn(executable, chromiumArgs(profileDir, Boolean(desktopEnv)), { stdio: ["ignore", "ignore", "pipe"], ...(desktopEnv ? { env: desktopEnv } : {}) });
    started.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (/DevTools listening/.test(text)) log("chromium", text.trim().split("\n")[0]);
    });
    started.on("exit", (code) => {
      log("browser", `chromium exited with ${code}`);
      if (!stopping) process.exit(1);
    });
    child = started;
  };

  start();
  const browser = await connectWithRetry();
  return wrap(browser, Boolean(desktopEnv), async () => {
    stopping = true;
    await browser.close().catch(() => {});
    child?.kill("SIGTERM");
  });
}

async function connectWithRetry(): Promise<Browser> {
  const deadline = Date.now() + 30000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(CDP_ENDPOINT);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`could not reach chromium on ${CDP_ENDPOINT}: ${(lastError as Error)?.message}`);
}

function wrap(browser: Browser, headed: boolean, close: () => Promise<void>): BrowserHandle {
  const context: BrowserContext = browser.contexts()[0];
  const sessions = new Map<Page, Promise<CDPSession>>();
  const background = new Set<Page>();
  const activeListeners: PageListener[] = [];
  const newPageListeners: PageListener[] = [];
  let active: Page | null = null;
  let activeSession: CDPSession | null = null;

  const sessionFor = (page: Page) => {
    let session = sessions.get(page);
    if (!session) {
      session = context.newCDPSession(page);
      sessions.set(page, session);
    }
    return session;
  };

  const activate = async (page: Page) => {
    if (page.isClosed()) return;
    const session = await sessionFor(page);
    active = page;
    activeSession = session;
    for (const listener of activeListeners) await listener(page, session);
  };

  const track = async (page: Page) => {
    page.on("close", () => {
      sessions.delete(page);
      if (active !== page) return;
      active = null;
      activeSession = null;
      const remaining = context.pages().filter((candidate) => !candidate.isClosed() && !background.has(candidate));
      if (remaining.length) void activate(remaining[remaining.length - 1]);
      else void context.newPage().catch(() => {});
    });
    const session = await sessionFor(page);
    if (!headed) {
      await session
        .send("Emulation.setDeviceMetricsOverride", { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false })
        .catch((error) => log("browser", `viewport failed: ${error.message}`));
    }
    for (const listener of newPageListeners) await listener(page, session);
  };

  let backgroundCount = 0;
  context.on("page", (page) => {
    if (page.url().includes(BACKGROUND_MARK)) {
      background.add(page);
      page.on("close", () => background.delete(page));
      return;
    }
    void track(page).then(() => activate(page)).catch((error) => log("browser", `new page failed: ${error.message}`));
  });

  const restored = context.pages().filter((page) => !page.url().includes(BACKGROUND_MARK));
  const keep = restored.find((page) => page.url() === "about:blank") ?? restored[restored.length - 1];
  for (const page of restored) if (page !== keep) void page.close().catch(() => {});
  const initial = keep ? [keep] : [];
  void (async () => {
    for (const page of initial) await track(page);
    const first = initial[initial.length - 1] ?? (await context.newPage());
    if (initial.length) await activate(first);
  })().catch((error) => log("browser", `initial pages failed: ${error.message}`));

  return {
    activePage: () => active,
    activeSession: () => activeSession,
    sessionFor,
    onActiveChange: (listener) => {
      activeListeners.push(listener);
      if (active && activeSession) void listener(active, activeSession);
    },
    onNewPage: (listener) => {
      newPageListeners.push(listener);
    },
    pages: () => context.pages().filter((page) => !background.has(page)),
    async openBackground() {
      const mark = `about:blank${BACKGROUND_MARK}${++backgroundCount}`;
      const waiting = context.waitForEvent("page", { predicate: (page) => page.url() === mark, timeout: 15000 });
      const session = await browser.newBrowserCDPSession();
      try {
        await session.send("Target.createTarget", { url: mark, background: true });
      } finally {
        await session.detach().catch(() => {});
      }
      return waiting;
    },
    close,
  };
}
