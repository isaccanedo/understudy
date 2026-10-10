import type { CDPSession } from "playwright-core";
import type { InputEvent } from "@understudy/protocol";

const KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  Meta: 91,
};

const KEY_TEXT: Record<string, string> = { Enter: "\r", Tab: "", " ": " " };

export function keyCodeFor(key: string): number {
  if (KEY_CODES[key] !== undefined) return KEY_CODES[key];
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (/[A-Z0-9]/.test(upper)) return upper.charCodeAt(0);
  }
  return 0;
}

export function keyEventParams(event: Extract<InputEvent, { kind: "key" }>): Record<string, unknown> | null {
  if (event.action === "char") return null;
  const printable = event.text ?? KEY_TEXT[event.key] ?? (event.key.length === 1 ? event.key : undefined);
  const params: Record<string, unknown> = {
    type: event.action === "up" ? "keyUp" : printable ? "keyDown" : "rawKeyDown",
    key: event.key,
    code: event.code ?? "",
    windowsVirtualKeyCode: keyCodeFor(event.key),
  };
  if (event.action === "down" && printable) {
    params.text = printable;
    params.unmodifiedText = printable;
  }
  return params;
}

export function mouseEventParams(event: Extract<InputEvent, { kind: "mouse" }>): Record<string, unknown> {
  const button = event.button ?? "left";
  switch (event.action) {
    case "down":
      return { type: "mousePressed", x: event.x, y: event.y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 };
    case "up":
      return { type: "mouseReleased", x: event.x, y: event.y, button, buttons: 0, clickCount: 1 };
    case "wheel":
      return { type: "mouseWheel", x: event.x, y: event.y, deltaX: 0, deltaY: event.deltaY ?? 0 };
    default:
      return { type: "mouseMoved", x: event.x, y: event.y, button: "none", buttons: 0 };
  }
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export async function applyInput(session: CDPSession, event: InputEvent): Promise<void> {
  if (event.kind === "navigate") {
    const url = normalizeUrl(event.url);
    if (!/^https?:/i.test(url)) return;
    await session.send("Page.navigate", { url });
    return;
  }
  if (event.kind === "mouse") {
    await session.send("Input.dispatchMouseEvent", mouseEventParams(event) as never);
    return;
  }
  if (event.action === "char") {
    const text = event.text ?? event.key;
    if (text) await session.send("Input.insertText", { text });
    return;
  }
  const params = keyEventParams(event);
  if (params) await session.send("Input.dispatchKeyEvent", params as never);
}
