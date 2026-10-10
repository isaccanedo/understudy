import { createHash } from "node:crypto";
import { findViolation, type OwnerRule } from "@understudy/protocol";
import type { BrowserHandle } from "./browser.ts";

export const WATCH_TEXT_LIMIT = 50 * 1024;
const LOAD_TIMEOUT_MS = 30000;
const SETTLE_MS = 2500;

export type WatchOutcome = { hash: string; text: string } | { error: string };

export const EXTRACT_PART = `(part) => {
  const clean = (text) => String(text || "").split("\\n").map((line) => line.replace(/\\s+/g, " ").trim()).filter(Boolean).join("\\n");
  if (!part) return { found: true, text: clean(document.body ? document.body.innerText : "") };
  const looksCss = /^[#.\\[]|^[a-z][a-z0-9-]*[#.\\[:>]/i.test(part);
  if (looksCss) {
    try {
      const found = document.querySelector(part);
      if (found) return { found: true, text: clean(found.innerText) };
    } catch {}
  }
  const needle = part.toLowerCase();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent || "").toLowerCase().includes(needle)) break;
    node = walker.nextNode();
  }
  if (!node || !node.parentElement) return { found: false, text: "" };
  let element = node.parentElement;
  while (element.parentElement && element.parentElement !== document.body && (element.innerText || "").length < 300) element = element.parentElement;
  return { found: true, text: clean(element.innerText) };
}`;

export function watchable(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function checkPage(browser: Pick<BrowserHandle, "openBackground">, request: { url: string; part?: string }, rules: OwnerRule[] = []): Promise<WatchOutcome> {
  const url = watchable(request.url);
  if (!url) return { error: "only http and https pages can be watched" };
  const violation = findViolation(rules, { urls: [url] });
  if (violation) return { error: `blocked by your owner's rule: ${violation.reason}` };
  let page: Awaited<ReturnType<BrowserHandle["openBackground"]>>;
  try {
    page = await browser.openBackground();
  } catch (error) {
    return { error: `could not open a background tab: ${(error as Error).message.split("\n")[0].slice(0, 200)}` };
  }
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    const finalHost = (() => {
      try {
        return new URL(page.url()).toString();
      } catch {
        return page.url();
      }
    })();
    const redirected = findViolation(rules, { urls: [finalHost] });
    if (redirected) return { error: `blocked by your owner's rule: ${redirected.reason}` };
    if (response && response.status() >= 400) return { error: `the page answered ${response.status()}` };
    const part = request.part?.trim().slice(0, 300) || "";
    const result = (await page.evaluate(`(${EXTRACT_PART})(${JSON.stringify(part)})`)) as { found: boolean; text: string };
    if (!result.found) return { error: `could not find "${part}" on the page` };
    const text = result.text.slice(0, WATCH_TEXT_LIMIT);
    return { hash: hashText(text), text };
  } catch (error) {
    return { error: (error as Error).message.split("\n")[0].slice(0, 300) };
  } finally {
    await page.close().catch(() => {});
  }
}
