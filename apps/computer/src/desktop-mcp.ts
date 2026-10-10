import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DESKTOP_APPS } from "./apps.ts";
import { DISPLAY, SCREEN } from "./desktop.ts";

const APPS: Record<string, string[]> = Object.fromEntries(DESKTOP_APPS.map((app) => [app.id, ["open-app", app.id]]));

const point = { x: { type: "number", description: `0 to ${SCREEN.width - 1}, left to right` }, y: { type: "number", description: `0 to ${SCREEN.height - 1}, top to bottom` } };

export const DESKTOP_TOOLS = [
  {
    name: "desktop_screenshot",
    description: `See your whole screen (${SCREEN.width}x${SCREEN.height}): every window, the app bar at the bottom and the browser with its tabs. Take one before clicking and after anything that changes the screen; coordinates for the other desktop tools come from this image.`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "desktop_click",
    description: "Click a point on the screen, in any program (terminal, files, Writer, Calc, dialogs, the app bar, the browser's own buttons).",
    inputSchema: {
      type: "object",
      properties: { ...point, button: { type: "string", enum: ["left", "right", "middle"] }, double: { type: "boolean" } },
      required: ["x", "y"],
    },
  },
  {
    name: "desktop_drag",
    description: "Press at one point, move to another and release (select text, move a window, drag a file).",
    inputSchema: {
      type: "object",
      properties: { fromX: point.x, fromY: point.y, toX: point.x, toY: point.y },
      required: ["fromX", "fromY", "toX", "toY"],
    },
  },
  {
    name: "desktop_type",
    description: "Type text into whatever has the keyboard focus.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "desktop_key",
    description: 'Press a key or a combination, like "Return", "Escape", "Tab", "ctrl+s", "ctrl+shift+t", "alt+Tab", "super".',
    inputSchema: { type: "object", properties: { keys: { type: "string" } }, required: ["keys"] },
  },
  {
    name: "desktop_scroll",
    description: "Scroll at a point. Positive amount scrolls down, negative up; each step is one wheel notch.",
    inputSchema: { type: "object", properties: { ...point, amount: { type: "number" } }, required: ["x", "y", "amount"] },
  },
  {
    name: "desktop_open",
    description: `Open a program on the screen: ${Object.keys(APPS).join(", ")}. Pass a file or folder in "path" to open it with that program.`,
    inputSchema: { type: "object", properties: { app: { type: "string", enum: Object.keys(APPS) }, path: { type: "string" } }, required: ["app"] },
  },
];

const clampX = (value: unknown) => String(Math.max(0, Math.min(SCREEN.width - 1, Math.round(Number(value) || 0))));
const clampY = (value: unknown) => String(Math.max(0, Math.min(SCREEN.height - 1, Math.round(Number(value) || 0))));

export function desktopCommand(name: string, args: Record<string, unknown>): string[] | null {
  if (name === "desktop_click") {
    const button = args.button === "right" ? "3" : args.button === "middle" ? "2" : "1";
    return ["mousemove", clampX(args.x), clampY(args.y), "click", ...(args.double ? ["--repeat", "2"] : []), button];
  }
  if (name === "desktop_drag") return ["mousemove", clampX(args.fromX), clampY(args.fromY), "mousedown", "1", "mousemove", "--sync", clampX(args.toX), clampY(args.toY), "mouseup", "1"];
  if (name === "desktop_type") return ["type", "--delay", "8", "--", String(args.text ?? "")];
  if (name === "desktop_key") {
    const keys = String(args.keys ?? "").trim().split(/\s+/).filter((key) => /^[A-Za-z0-9_+]+$/.test(key));
    return keys.length ? ["key", "--", ...keys] : null;
  }
  if (name === "desktop_scroll") {
    const amount = Math.round(Number(args.amount) || 0);
    if (!amount) return null;
    return ["mousemove", clampX(args.x), clampY(args.y), "click", "--repeat", String(Math.min(30, Math.abs(amount))), amount > 0 ? "5" : "4"];
  }
  return null;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, capture = false): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export async function callDesktopTool(name: string, args: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<{ content: Content[]; isError?: boolean }> {
  if (name === "desktop_screenshot") {
    const shot = await run("ffmpeg", ["-loglevel", "error", "-f", "x11grab", "-draw_mouse", "1", "-video_size", `${SCREEN.width}x${SCREEN.height}`, "-i", env.DISPLAY ?? DISPLAY, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4", "-"], env, true);
    if (shot.code !== 0 || !shot.stdout.length) return { content: [{ type: "text", text: `could not see the screen: ${shot.stderr.trim() || "no desktop"}` }], isError: true };
    return { content: [{ type: "image", data: shot.stdout.toString("base64"), mimeType: "image/jpeg" }] };
  }
  if (name === "desktop_open") {
    const app = APPS[String(args.app)];
    if (!app) return { content: [{ type: "text", text: `unknown app ${String(args.app)}` }], isError: true };
    const [command, ...rest] = app;
    const child = spawn(command, [...rest, ...(args.path ? [String(args.path)] : [])], { env, stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return { content: [{ type: "text", text: `opening ${String(args.app)}; take a screenshot in a moment to see it` }] };
  }
  const command = desktopCommand(name, args);
  if (!command) return { content: [{ type: "text", text: `nothing to do for ${name} with ${JSON.stringify(args)}` }], isError: true };
  const result = await run("xdotool", command, env);
  if (result.code !== 0) return { content: [{ type: "text", text: `${name} failed: ${result.stderr.trim() || `exit ${result.code}`}` }], isError: true };
  return { content: [{ type: "text", text: "done" }] };
}

async function serve() {
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || DISPLAY };
  const reply = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  for await (const line of createInterface({ input: process.stdin })) {
    let message: { id?: unknown; method?: string; params?: any };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    if (message.method === "initialize") reply(message.id, { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "understudy-desktop", version: "1" } });
    else if (message.method === "tools/list") reply(message.id, { tools: DESKTOP_TOOLS });
    else if (message.method === "ping") reply(message.id, {});
    else if (message.method === "tools/call" && DESKTOP_TOOLS.some((tool) => tool.name === message.params?.name)) {
      reply(message.id, await callDesktopTool(message.params.name, message.params.arguments ?? {}, env));
    } else {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } })}\n`);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  void serve();
}
