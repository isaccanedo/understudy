import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const SITE = process.env.E2E_SITE_URL || "http://host.docker.internal:39101/";
const INVOICES = new URL("invoices.html", SITE).toString();
const WATCHED = new URL("supplier-portal.html", SITE).toString();
const WATCHED_FILE = fileURLToPath(new URL("../site/supplier-portal.html", import.meta.url));
const ADMIN = { name: "Sam Rivera", email: "sam@northwind.example", password: "demo-admin-password-1" };
const OWNER = { name: "Maya Chen", email: "maya@northwind.example", temporary: "demo-temporary-pass-1", password: "demo-owner-password-1" };
const AGENT = "Ada";
const TASK = "Pay this week's supplier invoices";
const SCREEN_WIDTH = 1280;
const VIDEO = { width: 1280, height: 800 };

class Timeline {
  private start = Date.now();
  marks: { at: number; kind: "cut-start" | "cut-end" }[] = [];
  reset() {
    this.start = Date.now();
  }
  async wait<T>(work: () => Promise<T>) {
    this.marks.push({ at: (Date.now() - this.start) / 1000, kind: "cut-start" });
    try {
      return await work();
    } finally {
      this.marks.push({ at: (Date.now() - this.start) / 1000, kind: "cut-end" });
    }
  }
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
const typeSlowly = (page: Page, text: string) => page.keyboard.type(text, { delay: 45 });

async function clickOnScreen(page: Page, screen: Locator, x: number, y: number) {
  const box = await screen.boundingBox();
  if (!box) throw new Error("the live screen has no size");
  const scale = box.width / SCREEN_WIDTH;
  await page.mouse.move(box.x + x * scale, box.y + y * scale, { steps: 10 });
  await page.mouse.click(box.x + x * scale, box.y + y * scale);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function say(page: Page, text: string) {
  await expect(page.locator("canvas:not(.hidden)")).toBeVisible({ timeout: 2 * 60 * 1000 });
  const box = page.getByPlaceholder(new RegExp(`Talk to ${AGENT}`));
  await box.click();
  await typeSlowly(page, text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

function portal(rows: string[]) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Supplier portal</title><style>body{font:16px system-ui,sans-serif;margin:40px;color:#111}li{margin:6px 0}</style></head><body><h1>Northwind supplier portal</h1><section><h2>Open invoices</h2><ul>${rows.map((row) => `<li>${row}</li>`).join("")}</ul></section></body></html>`;
}

test("what's new: desktop and office files, terminal, rules, page watching", async ({ browser }) => {
  test.setTimeout(25 * 60 * 1000);
  writeFileSync(WATCHED_FILE, portal(["Acme Supplies · INV-2041 · $1,240.00"]));

  const setup = await browser.newContext({ viewport: VIDEO });
  const admin = await setup.newPage();
  await admin.goto("/setup");
  await admin.getByLabel("Your name").fill(ADMIN.name);
  await admin.getByLabel("Email").fill(ADMIN.email);
  await admin.getByLabel("Password").fill(ADMIN.password);
  await admin.getByRole("button", { name: "Create and sign in" }).click();
  await expect(admin.getByRole("heading", { name: "My understudies" })).toBeVisible();
  await admin.goto("/admin");
  const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: "Create account" }) });
  await form.getByLabel("Name").fill(OWNER.name);
  await form.getByLabel("Email").fill(OWNER.email);
  await form.getByLabel("Temporary password").fill(OWNER.temporary);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(admin.getByText(`Account created for ${OWNER.email}`)).toBeVisible();
  await setup.close();

  const prep: BrowserContext = await browser.newContext({ viewport: VIDEO });
  const helper = await prep.newPage();
  await signIn(helper, OWNER.email, OWNER.temporary);
  await helper.getByLabel("Temporary password").fill(OWNER.temporary);
  await helper.getByLabel("New password").fill(OWNER.password);
  await helper.getByRole("button", { name: "Save and continue" }).click();
  await expect(helper.getByRole("heading", { name: "My understudies" })).toBeVisible();
  await helper.goto("/agents/new");
  await helper.getByLabel("Name").fill(AGENT);
  await helper.getByLabel("What it does, in one sentence").fill("Pays our supplier invoices every Friday");
  await helper.getByRole("button", { name: "Create understudy" }).click();
  await helper.waitForURL(/\/agents\/[^/]+\/setup$/);
  const agentPath = new URL(helper.url()).pathname.replace(/\/setup$/, "");
  await expect(helper.getByText("connected as fake-brain")).toBeVisible({ timeout: 5 * 60 * 1000 });

  await helper.goto(`${agentPath}/teach`);
  const start = helper.getByRole("button", { name: "Start recording" });
  await expect(start).toBeEnabled({ timeout: 2 * 60 * 1000 });
  await start.click();
  const note = helper.getByPlaceholder("Explain why you do this step…");
  await note.fill(`Task: ${TASK}`);
  await helper.getByRole("button", { name: "Note" }).click();
  await helper.getByLabel("URL").fill(INVOICES);
  await helper.getByLabel("URL").press("Enter");
  await expect(helper.getByText(/Opened Northwind Payables/)).toBeVisible({ timeout: 60 * 1000 });
  const lessonScreen = helper.locator("canvas:not(.hidden)");
  await clickOnScreen(helper, lessonScreen, 312, 216);
  await helper.keyboard.type("Acme Supplies");
  await clickOnScreen(helper, lessonScreen, 312, 292);
  await helper.keyboard.type("INV-2041");
  await clickOnScreen(helper, lessonScreen, 312, 368);
  await helper.keyboard.type("1240.00");
  await clickOnScreen(helper, lessonScreen, 312, 492);
  await expect(helper.getByText(/Clicked Approve payment/)).toBeVisible({ timeout: 30 * 1000 });
  await helper.getByRole("button", { name: "I'm done" }).click();
  await helper.waitForURL(/\/recipes\/[^/]+$/, { timeout: 3 * 60 * 1000 });
  const recipePath = new URL(helper.url()).pathname;
  await expect(async () => {
    const turnOn = helper.getByRole("button", { name: "Turn it on" });
    if (await turnOn.isVisible()) await turnOn.click();
    await expect(helper.getByRole("button", { name: "Pause task" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30 * 1000 });

  const timeline = new Timeline();
  const context = await browser.newContext({ viewport: VIDEO, recordVideo: { dir: test.info().outputPath("video"), size: VIDEO }, storageState: await prep.storageState() });
  const page = await context.newPage();
  timeline.reset();

  await page.goto(`${agentPath}?tab=computer`);
  const screen = page.locator("canvas:not(.hidden)");
  await timeline.wait(() => expect(screen).toBeVisible({ timeout: 2 * 60 * 1000 }));
  await pause(page, 2500);
  await say(page, "make a spreadsheet of this weeks invoices");
  await timeline.wait(() => expect(page.getByText(/Saved outbox\/this-weeks-invoices\.xlsx/)).toBeVisible({ timeout: 2 * 60 * 1000 }));
  await pause(page, 3000);
  await page.getByRole("button", { name: "Take over" }).click();
  await pause(page, 1200);
  await clickOnScreen(page, screen, 1100, 700);
  await page.keyboard.press("Meta+o");
  await timeline.wait(() => pause(page, 6000));
  await pause(page, 7000);

  await page.goto(`${agentPath}/terminal`);
  await timeline.wait(() => expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 60 * 1000 }));
  await page.locator(".xterm").click();
  await pause(page, 600);
  await typeSlowly(page, "ls outbox && python3 -c \"import pandas as p; print(p.read_excel('outbox/this-weeks-invoices.xlsx').to_string(index=False))\"");
  await page.keyboard.press("Enter");
  await timeline.wait(() => expect(page.locator(".xterm-rows")).toContainText("Greenleaf", { timeout: 30 * 1000 }));
  await pause(page, 5500);

  await page.goto(`${agentPath}/setup`);
  const rules = page.getByRole("heading", { name: "Rules" });
  await rules.scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await page.getByRole("textbox", { name: "Never pay more than" }).click();
  await typeSlowly(page, "1000");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Never pay, approve or enter an amount above 1,000.")).toBeVisible();
  await pause(page, 3200);
  await page.goto(recipePath);
  await pause(page, 1200);
  await page.getByRole("button", { name: "Run now" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Run now" }).click();
  await pause(page, 1200);
  await page.goto(agentPath);
  await timeline.wait(() => expect(page.getByText(/Blocked by your rule/).first()).toBeVisible({ timeout: 3 * 60 * 1000 }));
  await page.getByText(/Blocked by your rule/).first().scrollIntoViewIfNeeded();
  await pause(page, 6500);

  await helper.goto(`${agentPath}/setup`);
  await helper.getByRole("button", { name: /^Remove: / }).click();
  await expect(helper.getByText("Add something it must never do, like paying over a limit or opening a site.")).toBeVisible();

  await page.goto(recipePath);
  const watchCard = page.getByRole("heading", { name: "Start when a page changes" });
  await watchCard.scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await page.getByLabel("Page address").click();
  await typeSlowly(page, WATCHED);
  await page.getByLabel("Only the part that says (optional)").click();
  await typeSlowly(page, "Open invoices");
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByText(/^Watching\./)).toBeVisible();
  await pause(page, 3500);

  await timeline.wait(async () => {
    await helper.goto(recipePath);
    await expect(async () => {
      await helper.reload();
      await expect(helper.getByText(/^Last checked:/)).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 2 * 60 * 1000 });
    writeFileSync(WATCHED_FILE, portal(["Acme Supplies · INV-2041 · $1,240.00", "Blue Harbor Logistics · INV-7783 · $860.50"]));
    await helper.getByRole("button", { name: "Watch", exact: true }).click();
    await expect(async () => {
      await helper.reload();
      await expect(helper.getByText(/^Last change seen:/)).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 2 * 60 * 1000 });
  });

  const agentId = agentPath.split("/").pop();
  await page.goto(`/runs?agent=${agentId}`);
  await pause(page, 2000);
  await page.locator('a[href^="/runs/"]').first().click();
  await page.waitForURL(/\/runs\/[^/?]+$/);
  await expect(page.getByText(/\+ Blue Harbor Logistics/)).toBeVisible();
  await pause(page, 5000);
  await page.goto("/waiting");
  const card = page.locator("div").filter({ hasText: `${AGENT} asks` }).filter({ has: page.getByRole("button", { name: "Go ahead" }) }).last();
  await timeline.wait(() =>
    expect(async () => {
      await page.reload();
      await expect(card).toContainText("Acme Supplies", { timeout: 3000 });
    }).toPass({ timeout: 2 * 60 * 1000 }),
  );
  await expect(card).toContainText("1240.00");
  await pause(page, 6000);

  await context.close();
  await prep.close();
  rmSync(WATCHED_FILE, { force: true });
  const mainVideo = await page.video()?.path();
  writeFileSync(test.info().outputPath("timeline.json"), JSON.stringify({ mainVideo, phoneVideo: null, marks: timeline.marks }, null, 2));
});
