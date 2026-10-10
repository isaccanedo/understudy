import { installCapture, RECORD_BINDING, RECORDER_SWITCH, SENSITIVE_AUTOCOMPLETE } from "@understudy/protocol/capture";
import { SENSITIVE_LABEL } from "@understudy/protocol/patterns";
import { copy } from "./copy.ts";
import { INDICATOR_ID } from "./logic.ts";
import type { ContentCommand, ContentRequest, Reply } from "./types.ts";

type Hello = ContentCommand & { serverUrl: string; productName: string };
type Scope = Record<string, unknown>;

const scope = window as unknown as Scope;
const READY_FLAG = "__understudyExtensionReady";

const STYLE = `
:host { all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.pill { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 999px; background: rgba(16,18,26,.82); border: 1px solid rgba(255,255,255,.12); color: #e6e6e6; font-size: 12.5px; font-weight: 600; letter-spacing: -.003em; box-shadow: 0 14px 40px -18px rgba(0,0,0,.8); backdrop-filter: blur(18px) saturate(150%); -webkit-backdrop-filter: blur(18px) saturate(150%); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #ff6363; box-shadow: 0 0 0 4px rgba(255,99,99,.2); animation: pulse 1.4s ease-in-out infinite; flex: none; }
.paused .dot { background: #f2b45a; box-shadow: 0 0 0 4px rgba(242,180,90,.2); animation: none; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
.label { white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); color: #e6e6e6; }
button:hover { background: rgba(255,255,255,.14); }
button.stop { background: #fff; color: #0b0c10; border-color: #fff; }
button:focus-visible { outline: 2px solid #63a1ff; outline-offset: 2px; }
.min { padding: 6px 9px; }
.collapsed .label, .collapsed button:not(.min) { display: none; }
`;

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let collapsed = false;
let productName = "Understudy";

function send(request: ContentRequest): Promise<Reply<unknown> | undefined> {
  return chrome.runtime.sendMessage(request).catch(() => undefined);
}

function removeIndicator() {
  host?.remove();
  host = null;
  shadow = null;
}

function paintIndicator(state: ContentCommand) {
  if (state.ended) return removeIndicator();
  if (!host) {
    host = document.createElement("understudy-recording");
    host.id = INDICATOR_ID;
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.append(style, document.createElement("div"));
  }
  if (!host.isConnected) (document.body ?? document.documentElement).append(host);
  const box = shadow?.lastElementChild as HTMLDivElement;
  const name = state.agentName ?? productName;
  box.className = `pill${state.paused ? " paused" : ""}${collapsed ? " collapsed" : ""}`;
  box.setAttribute("role", "status");
  box.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = state.paused ? copy.pillPaused(name) : copy.pillRecording(name);
  const toggle = document.createElement("button");
  toggle.textContent = state.paused ? copy.resume : copy.pause;
  toggle.addEventListener("click", () => void send({ type: "indicator", action: state.paused ? "resume" : "pause" }));
  const stop = document.createElement("button");
  stop.className = "stop";
  stop.textContent = copy.stop;
  stop.addEventListener("click", () => void send({ type: "indicator", action: "stop" }));
  const min = document.createElement("button");
  min.className = "min";
  min.textContent = collapsed ? "‹" : "›";
  min.setAttribute("aria-label", collapsed ? copy.pillShow : copy.pillHide);
  min.addEventListener("click", () => {
    collapsed = !collapsed;
    paintIndicator(state);
  });
  box.append(dot, label, toggle, stop, min);
}

function apply(state: ContentCommand) {
  scope[RECORDER_SWITCH] = state.on;
  paintIndicator(state);
}

function whenReady(run: () => void) {
  if (document.body) run();
  else document.addEventListener("DOMContentLoaded", run, { once: true });
}

async function boot() {
  if (scope[READY_FLAG]) {
    const reply = await send({ type: "hello" });
    if (reply?.ok) whenReady(() => apply(reply.value as Hello));
    return;
  }
  scope[READY_FLAG] = true;
  const reply = await send({ type: "hello" });
  if (!reply?.ok) return;
  const hello = reply.value as Hello;
  productName = hello.productName || productName;
  if (hello.serverUrl && location.origin === new URL(hello.serverUrl).origin) return;
  scope[RECORD_BINDING] = (payload: string) => {
    void send({ type: "captured", payload });
  };
  installCapture(RECORD_BINDING, RECORDER_SWITCH, SENSITIVE_LABEL.source, SENSITIVE_AUTOCOMPLETE.source);
  scope[RECORDER_SWITCH] = hello.on;
  chrome.runtime.onMessage.addListener((message: ContentCommand) => {
    if (message?.type !== "recorder") return false;
    whenReady(() => apply(message));
    return false;
  });
  whenReady(() => apply(hello));
}

void boot();
