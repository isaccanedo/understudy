import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { figure } from "@understudy/characters";
import type { AgentState, ServerToComputer } from "@understudy/protocol";
import { log } from "@understudy/runtime";
import { appInstalled, DESKTOP_APPS, findApp } from "./apps.ts";

export const HOME_PORT = 7690;
export const HOME_HOST = `127.0.0.1:${HOME_PORT}`;
export const HOME_URL = `http://${HOME_HOST}/`;
export const LAUNCH_HEADER = "x-understudy-home";

export type Profile = Omit<Extract<ServerToComputer, { type: "profile" }>, "type">;

const FACE_FOR_STATE: Partial<Record<AgentState, string>> = {
  working: "attentive",
  thinking: "curious",
  listening: "attentive",
  waiting_you: "excited",
  stuck: "confused",
  done: "happy",
};

const STATUS: Record<AgentState, string> = {
  calm: "Idle, ready for the next task",
  working: "Working",
  thinking: "Thinking",
  listening: "Listening",
  waiting_you: "Waiting for you",
  stuck: "Stuck, needs a hand",
  done: "Done",
};

const DOT: Record<AgentState, string> = {
  calm: "#3ECF8E",
  working: "#FF8A3D",
  thinking: "#8B6CF6",
  listening: "#3B93F0",
  waiting_you: "#F5C33B",
  stuck: "#EF5350",
  done: "#3ECF8E",
};

const DEFAULT_PROFILE: Profile = { name: "", look: { body: "cloud", color: "#3ECF8E", eyes: "neutral", acc: "none" } };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function statusLine(state: AgentState, note?: string): string {
  const base = STATUS[state] ?? STATUS.calm;
  const detail = note?.trim().replace(/\s+/g, " ").slice(0, 90);
  return state === "working" && detail ? `${base} · ${detail}` : base;
}

export function greeting(profile: Profile): string {
  return profile.ownerName ? `Welcome back, ${profile.ownerName}` : "Welcome back";
}

export function homeFigure(profile: Profile, state: AgentState): string {
  const look = profile.look;
  return figure({ shape: look.body, color: look.color, face: FACE_FOR_STATE[state] ?? look.eyes, acc: look.acc ?? "none", accColor: look.accColor }, "home");
}

const DOODLES = [
  { x: 9, y: 15, d: "M20 34V18M20 22c-6 0-10-4-10-10 6 0 10 4 10 10zM20 18c0-6 4-10 10-10 0 6-4 10-10 10z" },
  { x: 85, y: 19, d: "M18 4l3.5 9 9.5.5-7.5 6 2.5 9.5-8-5.5-8 5.5 2.5-9.5-7.5-6 9.5-.5z" },
  { x: 5, y: 54, d: "M4 18c6-12 12 12 18 0s12 12 18 0" },
  { x: 90, y: 52, d: "M8 30c0-14 8-22 22-22 0 14-8 22-22 22zM8 30l12-12" },
  { x: 19, y: 38, d: "M15 4c6 7 8 11 8 15a8 8 0 0 1-16 0c0-4 2-8 8-15z" },
  { x: 78, y: 41, d: "M15 4c6 7 8 11 8 15a8 8 0 0 1-16 0c0-4 2-8 8-15z" },
  { x: 14, y: 78, d: "M18 4l3.5 9 9.5.5-7.5 6 2.5 9.5-8-5.5-8 5.5 2.5-9.5-7.5-6 9.5-.5z" },
  { x: 83, y: 76, d: "M20 34V18M20 22c-6 0-10-4-10-10 6 0 10 4 10 10zM20 18c0-6 4-10 10-10 0 6-4 10-10 10z" },
  { x: 69, y: 11, d: "M4 18c6-12 12 12 18 0s12 12 18 0" },
  { x: 30, y: 13, d: "M8 30c0-14 8-22 22-22 0 14-8 22-22 22zM8 30l12-12" },
];

export function renderHome(profile: Profile, state: AgentState, note: string | undefined, home: string, exists: (path: string) => boolean = existsSync): string {
  const title = profile.name ? escapeHtml(profile.name) : "Understudy";
  const doodles = DOODLES.map((doodle) => `<svg class="doodle" style="left:${doodle.x}%;top:${doodle.y}%" viewBox="0 0 40 40"><path d="${doodle.d}"/></svg>`).join("");
  const apps = DESKTOP_APPS.map((app) => {
    const ready = appInstalled(app, home, exists);
    const tag = ready ? "" : `<span class="tag">${escapeHtml(app.installable?.label ?? "")} · get</span>`;
    return `<button class="app${ready ? "" : " missing"}" data-app="${app.id}"><span class="ic" style="background:${app.color}"><svg viewBox="0 0 24 24">${app.icon}</svg></span>${escapeHtml(app.name)}${tag}</button>`;
  }).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:,">
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;background-color:#f4ece2}
body{overflow:hidden;background:radial-gradient(70% 60% at 50% 35%,#fffaf4,#f4ece2 70%,#efe4d6);color:#2b2621;font-family:Poppins,Inter,"DejaVu Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.doodle{position:fixed;width:38px;height:38px;stroke:#d8cbbb;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.top{position:fixed;top:16px;left:20px;right:20px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#7a6f63}
.pill{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #ebe1d4;border-radius:99px;padding:6px 14px 6px 10px;box-shadow:0 6px 18px -12px rgb(80 50 20/.35);max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
main{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:40px}
.bubble{position:relative;background:#fff;border:1px solid #ebe1d4;border-radius:16px;padding:12px 36px 12px 16px;font-size:14px;line-height:1.45;max-width:330px;box-shadow:0 14px 30px -18px rgb(80 50 20/.4);margin:0 0 6px 130px}
.bubble:after{content:"";position:absolute;left:44px;bottom:-8px;width:14px;height:14px;background:#fff;border-right:1px solid #ebe1d4;border-bottom:1px solid #ebe1d4;transform:rotate(45deg)}
.bubble button{position:absolute;top:6px;right:8px;border:0;background:none;color:#b3a796;font-size:16px;cursor:pointer;padding:4px}
.bubble[hidden]{display:none}
.char{width:132px;height:132px}
.char svg{width:100%;height:100%}
.clock{font-size:84px;font-weight:500;letter-spacing:-.04em;line-height:1;margin-top:4px}
.clock small{font-size:15px;letter-spacing:0;margin-left:6px;color:#8a7e70;font-weight:500}
.hello{font-size:20px;color:#5c5248;margin-top:10px}
.grid{display:grid;grid-template-columns:repeat(5,92px);gap:20px 26px;margin-top:40px}
.app{display:flex;flex-direction:column;align-items:center;gap:8px;font:inherit;font-size:12.5px;color:#4d443b;background:none;border:0;padding:8px 0;border-radius:16px;cursor:pointer}
.app:hover{background:rgb(255 255 255/.6)}
.app:focus-visible{outline:2px solid #3B93F0;outline-offset:2px}
.ic{width:54px;height:54px;border-radius:15px;display:grid;place-items:center;box-shadow:0 10px 20px -12px rgb(60 40 20/.55),inset 0 1px 0 rgb(255 255 255/.35)}
.ic svg{width:27px;height:27px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.missing .ic{opacity:.55}
.tag{font-size:10.5px;color:#a4977f;margin-top:-5px}
</style></head>
<body>
${doodles}
<div class="top"><div class="pill"><span class="dot" id="dot" style="background:${DOT[state] ?? DOT.calm}"></span><span id="status">${escapeHtml(statusLine(state, note))}</span></div><div id="date"></div></div>
<main>
<div class="bubble" id="bubble">This is my computer. Watch me work, or take control when you need to.<button id="hide" aria-label="Hide">×</button></div>
<div class="char" id="char">${homeFigure(profile, state)}</div>
<div class="clock" id="clock"></div>
<div class="hello" id="hello">${escapeHtml(greeting(profile))}</div>
<div class="grid">${apps}</div>
</main>
<script>
const two = (n) => String(n).padStart(2, "0");
function tick() {
  const now = new Date();
  const h = now.getHours() % 12 || 12;
  document.getElementById("clock").innerHTML = h + ":" + two(now.getMinutes()) + "<small>" + (now.getHours() < 12 ? "AM" : "PM") + "</small>";
  document.getElementById("date").textContent = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
tick();
setInterval(tick, 5000);
try { if (localStorage.getItem("bubble") === "hidden") document.getElementById("bubble").hidden = true; } catch {}
document.getElementById("hide").addEventListener("click", () => {
  document.getElementById("bubble").hidden = true;
  try { localStorage.setItem("bubble", "hidden"); } catch {}
});
for (const button of document.querySelectorAll(".app")) {
  button.addEventListener("click", () => {
    fetch("/launch/" + button.dataset.app, { method: "POST", headers: { "${LAUNCH_HEADER}": "1" } }).catch(() => {});
  });
}
let last = "";
async function poll() {
  try {
    const response = await fetch("/status");
    const status = await response.json();
    document.getElementById("status").textContent = status.line;
    document.getElementById("dot").style.background = status.dot;
    document.getElementById("hello").textContent = status.hello;
    document.title = status.title;
    if (status.figure !== last) {
      last = status.figure;
      document.getElementById("char").innerHTML = status.figure;
    }
  } catch {}
}
setInterval(poll, 3000);
</script>
</body></html>`;
}

export function launchAllowed(request: Pick<IncomingMessage, "method" | "headers">): boolean {
  return request.method === "POST" && request.headers.host === HOME_HOST && request.headers[LAUNCH_HEADER] === "1" && (request.headers.origin === undefined || request.headers.origin === `http://${HOME_HOST}`);
}

export type HomePage = {
  setProfile: (profile: Profile) => void;
  setState: (state: AgentState, note?: string) => void;
  close: () => void;
};

export function startHome(home: string, appEnv: NodeJS.ProcessEnv): HomePage {
  const profileFile = join(home, ".understudy", "profile.json");
  let profile = DEFAULT_PROFILE;
  try {
    profile = { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(profileFile, "utf8")) };
  } catch {}
  let state: AgentState = "calm";
  let note: string | undefined;

  const reply = (response: ServerResponse, status: number, type: string, body: string) => {
    response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:" });
    response.end(body);
  };

  const server = createServer((request, response) => {
    if (request.headers.host !== HOME_HOST) return reply(response, 421, "text/plain", "");
    const path = (request.url ?? "/").split("?")[0];
    if (request.method === "GET" && path === "/") return reply(response, 200, "text/html; charset=utf-8", renderHome(profile, state, note, home));
    if (request.method === "GET" && path === "/status") {
      return reply(response, 200, "application/json", JSON.stringify({ line: statusLine(state, note), dot: DOT[state] ?? DOT.calm, figure: homeFigure(profile, state), hello: greeting(profile), title: profile.name || "Understudy" }));
    }
    const launch = path.match(/^\/launch\/([a-z]+)$/);
    if (launch) {
      const app = findApp(launch[1]);
      if (!app || !launchAllowed(request)) return reply(response, 403, "text/plain", "");
      const child = spawn("open-app", [app.id], { env: appEnv, cwd: home, detached: true, stdio: "ignore" });
      child.on("error", (error) => log("home", `could not open ${app.id}: ${error.message}`));
      child.unref();
      return reply(response, 204, "text/plain", "");
    }
    reply(response, 404, "text/plain", "");
  });
  server.on("error", (error) => log("home", `home page is off: ${error.message}`));
  server.listen(HOME_PORT, "127.0.0.1");

  return {
    setProfile(next) {
      profile = { ...DEFAULT_PROFILE, ...next };
      try {
        mkdirSync(dirname(profileFile), { recursive: true });
        writeFileSync(profileFile, JSON.stringify(profile));
      } catch {}
    },
    setState(next, nextNote) {
      state = next;
      note = nextNote;
    },
    close() {
      server.close();
    },
  };
}
