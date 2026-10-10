import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseServerToComputer, PROTOCOL_VERSION, type ComputerToServer, type ServerToComputer } from "@understudy/protocol";
import { createAgent } from "./agent.ts";
import { computerSocketUrl } from "./endpoints.ts";
import { launchBrowser } from "./browser.ts";
import { applyInput } from "./input.ts";
import { desktopEnabled, startDesktop } from "./desktop.ts";
import { codexSandboxWorks, createLoginManager } from "./login.ts";
import { codexEnabled } from "./brain.ts";
import { createMemory, pruneRuns } from "./memory.ts";
import { startMemorySync } from "./memory-sync.ts";
import { answerFileMessage, createFileStore, startFileExchange } from "./files.ts";
import { connectBench } from "./bench-client.ts";
import { startLocalWorkbench } from "./workbench.ts";
import { readRules, rulesFile, writeRules } from "./rules-store.ts";
import { checkPage } from "./watch.ts";
import { turnStateFile } from "./turn-state.ts";
import { openVault, validCredentialName } from "./vault.ts";
import { createRecorder } from "./recorder.ts";
import { startScreencastControl } from "./screencast.ts";
import { startHome } from "./home.ts";
import { log, openLink } from "@understudy/runtime";

const BUILD = process.env.UNDERSTUDY_VERSION || "dev";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    log("main", `missing ${name}`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const agentId = required("AGENT_ID");
  const token = required("AGENT_TOKEN");
  const serverUrl = required("UNDERSTUDY_SERVER_URL");
  const home = process.env.HOME || "/home/agent";
  const workDir = join(home, "files");
  const stateDir = join(home, ".understudy");

  const desktop = desktopEnabled() ? await startDesktop(home).catch(() => null) : null;
  const homePage = desktop ? startHome(home, desktop.appEnv) : null;
  const browser = await launchBrowser(join(home, "browser-profile"), desktop?.env);
  log("main", "browser ready");

  let send: (message: ComputerToServer) => boolean = () => false;
  const outbox = (message: ComputerToServer) => {
    if (message.type === "state") homePage?.setState(message.state, message.note);
    return send(message);
  };
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const link = openLink<ServerToComputer, ComputerToServer>({
    url: computerSocketUrl(serverUrl, agentId),
    token,
    parse: parseServerToComputer,
    onOpen: () => {
      void ready.then(() => sayHello());
    },
    onMessage: (message) => {
      void ready
        .then(() => dispatch(message))
        .catch((error) => log("main", `${message.type} failed: ${(error as Error).message}`));
    },
    onClose: () => {
      void ready.then(() => screencast.setViewers(0));
    },
  });
  send = (message) => link.send(message);

  const screencast = startScreencastControl(
    browser,
    outbox,
    () => link.pressure(),
    desktop?.stream(outbox, () => link.pressure(), () => browser.activePage()?.url() ?? ""),
  );
  const recorder = createRecorder({
    browser,
    send: outbox,
    baseDir: join(home, "runs"),
    onActiveChange: (recording) => screencast.setRecording(recording),
  });
  let codexAvailable = false;
  if (codexEnabled()) {
    codexAvailable = await codexSandboxWorks({ ...process.env, HOME: home });
    log("main", codexAvailable ? "codex enabled, sandbox works" : "codex requested but its sandbox cannot start here (needs user namespaces); keeping it off");
  }
  const login = createLoginManager({ home, workDir, send: outbox, codexAvailable: () => codexAvailable });
  const prune = () => {
    const removed = pruneRuns(join(home, "runs"));
    if (removed.length) log("main", `removed ${removed.length} run folder(s) older than 30 days`);
  };
  prune();
  setInterval(prune, 6 * 60 * 60 * 1000).unref();
  const memorySync = startMemorySync(join(home, "memory"), outbox, { dir: join(home, "files", "skills"), parent: join(home, "files") });
  const files = startFileExchange(home, outbox);
  const store = createFileStore(home);
  let lastJobs = "";
  const workbench = startLocalWorkbench(home, desktop?.env.DISPLAY);
  const bench = connectBench((event) => {
    if (event.op === "term_output") outbox({ type: "terminal_output", terminalId: event.id, data: event.data });
    if (event.op === "term_exit") outbox({ type: "terminal_exit", terminalId: event.id, ...(event.reason ? { reason: event.reason } : {}) });
    if (event.op === "jobs") {
      const jobs = event.jobs.slice(-100);
      const snapshot = JSON.stringify(jobs);
      if (snapshot !== lastJobs && outbox({ type: "jobs", jobs })) lastJobs = snapshot;
    }
  });
  setInterval(() => bench.send({ op: "job_list", id: "main" }), 15000).unref();
  const vault = openVault(home);
  const sendCredentials = () => link.send({ type: "credentials", credentials: vault.list() });
  const screenshot = async () => {
    const session = browser.activeSession();
    if (!session) return undefined;
    const shot = (await session.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 45,
      clip: { x: 0, y: 0, width: 1280, height: 800, scale: 0.5 },
    })) as { data: string };
    return shot.data;
  };
  const agent = createAgent({
    screenshot,
    turnFile: turnStateFile(home),
    config: { home, workDir, serverUrl, token },
    memory: createMemory(home),
    settingsFile: join(stateDir, "settings.json"),
    rulesFile: rulesFile(home),
    send: outbox,
  });

  if (agent.brain() === "codex" && !codexAvailable) agent.setBrain("claude");

  const sayHello = async () => {
    const brains = await login.status();
    const model = agent.model();
    link.send({ type: "hello", agentId, version: PROTOCOL_VERSION, build: BUILD, brains, ...(model ? { model } : {}) });
    outbox({ type: "state", state: agent.state() });
    memorySync.publish();
    files.publish();
    sendCredentials();
    lastJobs = "";
    bench.send({ op: "job_list", id: "main" });
  };

  let watchQueue: Promise<void> = Promise.resolve();
  const dispatch = async (message: ServerToComputer) => {
    switch (message.type) {
      case "ping":
        link.send({ type: "pong", at: message.at });
        return;
      case "viewers":
        screencast.setViewers(message.count);
        return;
      case "input": {
        const session = browser.activeSession();
        if (desktop && message.event.kind !== "navigate") desktop.input(message.event);
        else if (session) await applyInput(session, message.event);
        return;
      }
      case "chat":
        agent.enqueue({
          kind: "chat",
          text: message.text,
          from: message.from,
          ...(message.fromAgent ? { fromAgent: message.fromAgent } : {}),
          ...(message.model ? { model: message.model } : {}),
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          ...(message.artifactEdit ? { artifactEdit: message.artifactEdit } : {}),
        });
        return;
      case "room_turn":
        agent.enqueue({ kind: "room", roomId: message.roomId, prompt: message.prompt, ...(message.model ? { model: message.model } : {}) });
        return;
      case "record_start":
        await recorder.start(message.recordingId);
        return;
      case "record_narration":
        recorder.narrate(message.recordingId, message.text);
        return;
      case "record_stop": {
        const events = await recorder.stop(message.recordingId);
        if (events) agent.enqueue({ kind: "recipe", recordingId: message.recordingId, events });
        return;
      }
      case "run_recipe":
        agent.enqueue({
          kind: "run",
          runId: message.runId,
          recipe: message.recipe,
          approvalsRequired: message.approvalsRequired,
          context: message.context,
          webhook: message.webhook === true,
          ...(message.model ? { model: message.model } : {}),
        });
        return;
      case "approval_answer":
        log("main", `approval ${message.requestId} answered ${message.approved ? "yes" : "no"} (handled by the gatekeeper)`);
        return;
      case "login_start":
        await login.start(message.brain);
        return;
      case "login_code":
        await login.code(message.brain, message.code);
        return;
      case "terminal_open":
        if (!bench.send({ op: "term_open", id: message.terminalId, cols: message.cols, rows: message.rows })) {
          link.send({ type: "terminal_exit", terminalId: message.terminalId, reason: "the workbench is not reachable" });
        }
        return;
      case "terminal_input":
        bench.send({ op: "term_input", id: message.terminalId, data: message.data });
        return;
      case "terminal_resize":
        bench.send({ op: "term_resize", id: message.terminalId, cols: message.cols, rows: message.rows });
        return;
      case "terminal_close":
        bench.send({ op: "term_close", id: message.terminalId });
        return;
      case "watch_check":
        watchQueue = watchQueue.then(async () => {
          const outcome = await checkPage(browser, { url: message.url, part: message.part }, readRules(rulesFile(home)));
          link.send({ type: "watch_result", watchId: message.watchId, ...outcome });
        }).catch((error) => log("watch", `check failed: ${(error as Error).message}`));
        return;
      case "profile":
        homePage?.setProfile({ name: message.name, look: message.look, ...(message.ownerName ? { ownerName: message.ownerName } : {}) });
        return;
      case "set_rules":
        writeRules(rulesFile(home), message.rules);
        log("main", `owner rules updated: ${message.rules.length}`);
        return;
      case "job_stop":
        bench.send({ op: "job_stop", jobId: message.jobId });
        return;
      case "set_model":
        agent.setModel(message.model);
        void sayHello();
        return;
      case "set_brain":
        if (message.brain === "codex" && !codexAvailable) {
          log("main", "refused set_brain codex: codex is off on this computer");
          return;
        }
        agent.setBrain(message.brain);
        return;
      case "memory_write":
        memorySync.write(message.path, message.text);
        return;
      case "memory_delete":
        memorySync.remove(message.path);
        return;
      case "file_put":
        if (files.put(message.path, message.base64)) log("main", `owner uploaded ${message.path}`);
        return;
      case "file_get":
        link.send(files.get(message.requestId, message.path));
        return;
      case "upload_open":
      case "upload_chunk":
      case "upload_finish":
      case "upload_cancel":
      case "file_read":
      case "file_thumb":
      case "file_share":
      case "artifact_render":
      case "artifact_page": {
        const reply = await answerFileMessage(store, message);
        if (reply) link.send(reply);
        if (message.type === "file_share") files.publish();
        return;
      }
      case "teach_text":
        agent.enqueue({ kind: "recipe", recordingId: message.recordingId, events: [], description: message.text });
        return;
      case "teach_recording":
        agent.enqueue({ kind: "recipe", recordingId: message.recordingId, events: message.events, ownerBrowser: message.ownerBrowser === true });
        return;
      case "credential_set":
        if (!validCredentialName(message.name)) {
          log("main", "refused a credential with an invalid name");
          return;
        }
        if (!message.site?.trim()) {
          log("main", "refused a credential without a site");
          return;
        }
        vault.set(message.name, message.username, message.secret, message.site);
        sendCredentials();
        return;
      case "credential_delete":
        vault.remove(message.name);
        sendCredentials();
        return;
      case "stop":
        agent.stop();
        return;
      default:
        log("main", `ignored message ${(message as { type: string }).type}`);
    }
  };

  const guardSocket = join(stateDir, "guard.sock");
  rmSync(guardSocket, { force: true });
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  createServer((connection) => {
    createInterface({ input: connection }).on("line", (line) => {
      try {
        agent.guardEvent(JSON.parse(line));
      } catch {}
    });
  }).listen(guardSocket, () => chmodSync(guardSocket, 0o600));

  markReady();

  const shutdown = async () => {
    log("main", "shutting down");
    agent.stop();
    link.close();
    await browser.close();
    workbench.stop();
    desktop?.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error) => {
  log("main", `fatal: ${(error as Error).stack ?? error}`);
  process.exit(1);
});
