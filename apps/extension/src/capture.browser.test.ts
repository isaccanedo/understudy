import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright-core";
import { captureScript, parseCaptured, RECORD_BINDING } from "@understudy/protocol/capture";

const CHROME = process.env.CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => existsSync(path));
const skip = !CHROME && "set CHROME_PATH to run the capture test in a real browser";

const PAGE = `<!doctype html><html><body>
<form onsubmit="return false">
  <label>Supplier <input id="supplier" name="supplier"></label>
  <label>Password <input id="pw" type="password"></label>
  <input id="card" autocomplete="cc-number" placeholder="Card">
  <input id="otp" autocomplete="one-time-code" placeholder="Code">
  <label>CVV <input id="cvv"></label>
  <label>Notes <input id="notes"></label>
  <select id="state" aria-label="State"><option>SP</option><option>RJ</option></select>
  <button id="save" type="submit">Save invoice</button>
</form></body></html>`;

let browser: Browser;

before(async () => {
  if (!skip) browser = await chromium.launch({ executablePath: CHROME, headless: true });
});

after(async () => {
  await browser?.close();
});

test("the shared capture script masks secrets in a real page", { skip }, async () => {
  const page = await browser.newPage();
  const payloads: string[] = [];
  await page.exposeBinding(RECORD_BINDING, (_source, payload: string) => {
    payloads.push(payload);
  });
  await page.setContent(PAGE);
  await page.evaluate(captureScript());
  await page.fill("#supplier", "ACME Ltda");
  await page.fill("#pw", "hunter2");
  await page.fill("#card", "4111111111111111");
  await page.fill("#otp", "482913");
  await page.fill("#cvv", "123");
  await page.fill("#notes", "5500 0000 0000 0004");
  await page.selectOption("#state", "RJ");
  await page.click("#save");
  await page.waitForTimeout(1400);
  const events = payloads.map((payload) => parseCaptured(payload)).filter((event) => event !== null);
  const inputs = new Map(events.flatMap((event) => (event.kind === "input" ? [[event.selector, event] as const] : [])));
  assert.equal(inputs.get("#supplier")?.value, "ACME Ltda");
  assert.equal(inputs.get("#supplier")?.masked, false);
  for (const selector of ["#pw", "#card", "#otp", "#cvv", "#notes"]) {
    const event = inputs.get(selector);
    assert.ok(event, `${selector} was captured`);
    assert.equal(event.masked, true, `${selector} is masked`);
    assert.equal(event.value, "••••••");
  }
  for (const secret of ["hunter2", "4111111111111111", "482913"]) {
    assert.ok(!payloads.some((payload) => payload.includes(secret)), `${secret} never leaves the page`);
  }
  assert.ok(events.some((event) => event.kind === "select" && event.value === "RJ"));
  assert.ok(events.some((event) => event.kind === "click" && event.label === "Save invoice"));
});

test("turning the switch off stops capturing", { skip }, async () => {
  const page = await browser.newPage();
  const payloads: string[] = [];
  await page.exposeBinding(RECORD_BINDING, (_source, payload: string) => {
    payloads.push(payload);
  });
  await page.setContent(PAGE);
  await page.evaluate(captureScript());
  await page.evaluate("window.__understudyRecorderOn = false");
  await page.click("#save");
  await page.waitForTimeout(200);
  assert.equal(payloads.length, 0);
});
