import { copy, errorText } from "./copy.ts";
import { clock, elapsedMs } from "./logic.ts";
import type { Agent, PopupRequest, Reply, Status } from "./types.ts";

type Attrs = Record<string, string | boolean | ((event: Event) => void)>;
type Child = Node | string | null | false | undefined;

const app = document.getElementById("app") as HTMLElement;
let status: Status | null = null;
let view = "";
let agents: Agent[] | null = null;
let chosen: string | null = null;
let voice = true;
let note = "";
let busy = false;
const draft = { server: "", code: "" };

function h(tag: string, attrs: Attrs = {}, ...children: Child[]) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) element.setAttribute(key, "");
    else if (value !== false) element.setAttribute(key, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

async function ask<T>(request: PopupRequest): Promise<Reply<T>> {
  try {
    return ((await chrome.runtime.sendMessage(request)) as Reply<T> | undefined) ?? { ok: false, error: "unknown" };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

function serverUrl() {
  return status?.pairing?.serverUrl || status?.config.serverUrl || "";
}

function openPanel(path = "") {
  const base = serverUrl();
  if (base) void chrome.tabs.create({ url: `${base}${path}` });
}

function brand() {
  const name = status?.pairing?.productName || status?.config.productName || "Understudy";
  const logo = h("img", { src: "icons/icon-32.png", alt: "" }) as HTMLImageElement;
  logo.addEventListener("error", () => logo.remove());
  return h("div", { class: "brand" }, logo, name, status?.pairing ? h("span", { class: "who" }, copy.signedInAs(status.pairing.userName)) : null);
}

function message() {
  const error = errorText(status?.session.error) || note;
  return error ? h("p", { class: "err", role: "alert" }, error) : null;
}

async function act(request: PopupRequest) {
  busy = true;
  note = "";
  paint(true);
  const result = await ask(request);
  busy = false;
  if (!result.ok) note = errorText(result.error);
  await refresh(true);
}

function pairView() {
  const server = h("input", { class: "in", id: "server", type: "url", autocomplete: "off", spellcheck: "false", value: draft.server || status?.config.serverUrl || "", placeholder: "https://", onInput: (event) => (draft.server = (event.target as HTMLInputElement).value) }) as HTMLInputElement;
  const code = h("input", { class: "in code", id: "code", autocomplete: "one-time-code", inputmode: "text", maxlength: "9", placeholder: copy.codePlaceholder, spellcheck: "false", value: draft.code, onInput: (event) => (draft.code = (event.target as HTMLInputElement).value) }) as HTMLInputElement;
  const submit = h("button", { class: "btn pri wide", type: "submit", disabled: busy }, busy ? copy.connecting : copy.connect);
  const form = h(
    "form",
    {
      class: "card",
      onSubmit: (event) => {
        event.preventDefault();
        void act({ type: "pair", serverUrl: server.value, code: code.value });
      },
    },
    h("h1", {}, copy.connectTitle),
    h("p", { class: "muted" }, copy.connectBody),
    status?.config.serverUrl ? null : h("label", { class: "field" }, copy.panelLabel, server),
    h("label", { class: "field" }, copy.codeLabel, code),
    message(),
    submit,
    h("button", { class: "btn link", type: "button", onClick: () => openPanel("/extension") }, copy.whereIsCode),
  );
  setTimeout(() => code.focus(), 0);
  return [brand(), form];
}

function agentButton(agent: Agent) {
  const selected = chosen === agent.id;
  const avatar = h("img", { src: agent.avatarUrl, alt: "" }) as HTMLImageElement;
  return h(
    "button",
    {
      class: "agent",
      type: "button",
      role: "radio",
      "aria-checked": selected ? "true" : "false",
      onClick: () => {
        chosen = agent.id;
        paint(true);
      },
    },
    avatar,
    h("span", {}, h("div", { class: "name" }, agent.name), agent.role ? h("div", { class: "role" }, agent.role) : null),
    h("span", { class: `pill ${agent.online ? "g" : ""}` }, h("span", { class: "dot" }), agent.online ? copy.online : copy.offline),
  );
}

async function startRecording() {
  if (!chosen) return;
  if (voice) {
    const permission = await navigator.permissions.query({ name: "microphone" as PermissionName }).catch(() => null);
    if (permission?.state !== "granted") {
      note = permission?.state === "denied" ? copy.micBlocked : copy.micNeeded;
      if (permission?.state !== "denied") void chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });
      paint(true);
      return;
    }
  }
  await act({ type: "start", agentId: chosen, voice });
}

function pickView() {
  if (agents === null) {
    void ask<Agent[]>({ type: "agents" }).then((result) => {
      agents = result.ok ? result.value : [];
      if (!result.ok) note = errorText(result.error);
      if (!chosen && agents.length) chosen = agents[0].id;
      paint(true);
    });
  }
  const list = agents === null ? h("div", { class: "spinner", "aria-hidden": "true" }) : agents.length ? h("div", { class: "agents", role: "radiogroup", "aria-label": copy.pickTitle }, ...agents.map(agentButton)) : h("p", { class: "muted" }, copy.noAgents);
  const toggle = h("button", {
    class: "tg",
    type: "button",
    role: "switch",
    "aria-checked": voice ? "true" : "false",
    "aria-label": copy.voice,
    onClick: () => {
      voice = !voice;
      note = "";
      paint(true);
    },
  });
  return [
    brand(),
    h(
      "section",
      { class: "card" },
      h("h1", {}, copy.pickTitle),
      list,
      h("div", { class: "toggle" }, h("span", {}, copy.voice), toggle, h("span", { class: "hint small" }, copy.voiceHint)),
      message(),
      h("button", { class: "btn warn wide", type: "button", disabled: busy || !chosen, onClick: () => void startRecording() }, busy ? copy.starting : copy.start),
      h("p", { class: "small" }, copy.privacy),
    ),
    h(
      "div",
      { class: "foot" },
      h("button", { class: "btn link", type: "button", onClick: () => openPanel("/") }, copy.openPanel),
      h("button", { class: "btn link", type: "button", onClick: () => void act({ type: "unpair" }) }, copy.disconnect),
    ),
  ];
}

function meter(level: number, on: boolean) {
  const bars = [0.5, 0.8, 1, 0.7, 0.9, 0.6, 0.4];
  return h("div", { class: `meter ${on ? "" : "off"}`, "aria-hidden": "true" }, ...bars.map((weight) => {
    const bar = h("i");
    bar.style.height = `${Math.round(4 + (on ? level : 0) * weight * 22)}px`;
    return bar;
  }));
}

function recordingView() {
  const session = (status as Status).session;
  const paused = session.phase === "paused";
  return [
    brand(),
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "rec" },
        h("span", { class: `badge ${paused ? "paused" : ""}` }, h("span", { class: `rec-dot ${paused ? "" : "on"}` }), `${paused ? copy.paused : copy.recording} · ${copy.recordingFor(session.agentName ?? "")}`),
        h("div", { class: "time", id: "time" }, clock(elapsedMs(session, Date.now()))),
        h("div", { id: "meter" }, meter(status?.level ?? 0, session.voice && !paused)),
        h("div", { class: "small", id: "voice" }, session.voice ? (paused ? copy.paused : copy.listening) : copy.silent),
        h("p", { class: "muted" }, copy.doTask),
        h("div", { class: "small", id: "steps" }, copy.steps(session.events)),
      ),
      message(),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn sec", type: "button", disabled: busy, onClick: () => void act({ type: paused ? "resume" : "pause" }) }, paused ? copy.resume : copy.pause),
        h("button", { class: "btn pri", type: "button", disabled: busy, onClick: () => void act({ type: "stop" }) }, copy.stop),
      ),
      h("p", { class: "small" }, copy.privacy),
    ),
    h("div", { class: "foot" }, h("span"), h("button", { class: "btn link", type: "button", disabled: busy, onClick: () => void act({ type: "discard" }) }, copy.discard)),
  ];
}

function waitingView() {
  const session = (status as Status).session;
  const finishing = session.phase === "finishing" || session.phase === "starting";
  return [
    brand(),
    h(
      "section",
      { class: "card" },
      h("div", { class: "rec" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("h1", {}, finishing ? copy.finishing : copy.processing(session.agentName ?? "")), finishing ? null : h("p", { class: "muted" }, copy.processingHint)),
      message(),
      session.agentId && !finishing ? h("button", { class: "btn sec wide", type: "button", onClick: () => openPanel(`/agents/${session.agentId}/teach`) }, copy.openPanel) : null,
    ),
  ];
}

function resultView() {
  const session = (status as Status).session;
  const done = session.phase === "done";
  return [
    brand(),
    h(
      "section",
      { class: "card" },
      h("div", { class: "rec" }, done ? h("div", { class: "check", "aria-hidden": "true" }, "✓") : null, h("h1", {}, done ? copy.done : copy.failed), done ? h("p", { class: "muted" }, copy.doneHint) : null),
      message(),
      done && session.agentId && session.recipeId
        ? h("button", { class: "btn pri wide", type: "button", onClick: () => openPanel(`/agents/${session.agentId}/recipes/${session.recipeId}`) }, copy.review)
        : session.agentId
          ? h("button", { class: "btn sec wide", type: "button", onClick: () => openPanel(`/agents/${session.agentId}`) }, copy.openPanel)
          : null,
      h(
        "button",
        {
          class: "btn sec wide",
          type: "button",
          onClick: () => {
            agents = null;
            void act({ type: "reset" });
          },
        },
        copy.again,
      ),
    ),
  ];
}

function viewKey(current: Status) {
  if (!current.pairing) return "pair";
  const phase = current.session.phase;
  if (phase === "recording" || phase === "paused") return `rec:${phase}`;
  if (phase === "starting" || phase === "finishing" || phase === "processing") return `wait:${phase}`;
  if (phase === "done" || phase === "failed") return `result:${phase}`;
  return "pick";
}

function paint(force = false) {
  if (!status) return;
  const key = viewKey(status);
  if (!force && key === view) {
    if (key.startsWith("rec:")) {
      const session = status.session;
      document.getElementById("time")?.replaceChildren(clock(elapsedMs(session, Date.now())));
      document.getElementById("steps")?.replaceChildren(copy.steps(session.events));
      document.getElementById("meter")?.replaceChildren(meter(status.level, session.voice && session.phase === "recording"));
    }
    return;
  }
  if (key !== view) note = force ? note : "";
  view = key;
  const parts = key === "pair" ? pairView() : key === "pick" ? pickView() : key.startsWith("rec:") ? recordingView() : key.startsWith("wait:") ? waitingView() : resultView();
  app.replaceChildren(...parts);
}

async function refresh(force = false) {
  const result = await ask<Status>({ type: "status" });
  if (!result.ok) return;
  const before = status?.pairing?.serverUrl;
  status = result.value;
  if (before !== status.pairing?.serverUrl) agents = null;
  paint(force);
}

void refresh(true);
setInterval(() => void refresh(), 250);
