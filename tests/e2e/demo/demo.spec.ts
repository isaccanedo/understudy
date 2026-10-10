import { writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const SITE = process.env.E2E_SITE_URL || "http://host.docker.internal:39101/";
const INVOICES = new URL("invoices.html", SITE).toString();
const ADMIN = { name: "Sam Rivera", email: "sam@northwind.example", password: "demo-admin-password-1" };
const OWNER = { name: "Maya Chen", email: "maya@northwind.example", temporary: "demo-temporary-pass-1", password: "demo-owner-password-1" };
const AGENT = "Ada";
const TEAMMATE = "Ben";
const TASK = "Pay this week's supplier invoices";
const SCREEN_WIDTH = 1440;
const VIDEO = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

type Mark = { at: number; kind: "cut-start" | "cut-end" };

class Timeline {
  private start = Date.now();
  marks: Mark[] = [];
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

async function pause(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

async function clickOnScreen(page: Page, screen: Locator, x: number, y: number, clickCount = 1) {
  const box = await screen.boundingBox();
  if (!box) throw new Error("the live screen has no size");
  const scale = box.width / SCREEN_WIDTH;
  await page.mouse.move(box.x + x * scale, box.y + y * scale, { steps: 12 });
  await page.mouse.click(box.x + x * scale, box.y + y * scale, { clickCount });
}

async function typeSlowly(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 55 });
}

async function signIn(page: Page, email: string, password: string, slow = false) {
  await page.goto("/sign-in");
  if (slow) {
    await page.getByLabel("Email").click();
    await typeSlowly(page, email);
    await page.getByLabel("Password").click();
    await typeSlowly(page, password);
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
  }
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function createUnderstudy(page: Page, name: string, purpose: string, slow: boolean) {
  await page.goto("/agents/new");
  if (slow) {
    await pause(page, 900);
    await page.getByLabel("Name").click();
    await typeSlowly(page, name);
    await page.getByLabel("What it does, in one sentence").click();
    await typeSlowly(page, purpose);
    await page.getByRole("button", { name: "Surprise me" }).click();
    await pause(page, 1400);
  } else {
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("What it does, in one sentence").fill(purpose);
  }
  await page.getByRole("button", { name: "Create understudy" }).click();
  await page.waitForURL(/\/agents\/[^/?]+\?tab=settings$/);
  return new URL(page.url()).pathname;
}

async function say(page: Page, agentName: string, text: string) {
  await expect(page.locator("canvas:not(.hidden)")).toBeVisible({ timeout: 2 * 60 * 1000 });
  const box = page.getByPlaceholder(new RegExp(`Talk to ${agentName}`));
  await box.click();
  await typeSlowly(page, text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("demo: teach a task once, run it with an approval, see what it did", async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);

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

  const prep = await browser.newContext({ viewport: VIDEO });
  const prepPage = await prep.newPage();
  await signIn(prepPage, OWNER.email, OWNER.temporary);
  await prepPage.getByLabel("Temporary password").fill(OWNER.temporary);
  await prepPage.getByLabel("New password").fill(OWNER.password);
  await prepPage.getByRole("button", { name: "Save and continue" }).click();
  await expect(prepPage.getByRole("heading", { name: "My understudies" })).toBeVisible();
  await createUnderstudy(prepPage, TEAMMATE, "Files paid invoices and tells accounting", false);
  await expect(prepPage.getByText("connected as fake-brain")).toBeVisible({ timeout: 5 * 60 * 1000 });
  await prep.close();

  const timeline = new Timeline();
  const videoDir = test.info().outputPath("video");
  const context: BrowserContext = await browser.newContext({ viewport: VIDEO, recordVideo: { dir: videoDir, size: VIDEO } });
  const page = await context.newPage();
  timeline.reset();

  await signIn(page, OWNER.email, OWNER.password, true);
  await expect(page.getByRole("heading", { name: "My understudies" })).toBeVisible();
  await pause(page, 2200);

  const agentPath = await createUnderstudy(page, AGENT, "Pays our supplier invoices every Friday", true);
  await timeline.wait(() => expect(page.getByText("connected as fake-brain")).toBeVisible({ timeout: 5 * 60 * 1000 }));
  await pause(page, 1800);

  await page.goto(`${agentPath}/teach`);
  await page.getByRole("link", { name: "Teach on its computer" }).click();
  await page.waitForURL(/\/teach\?mode=remote$/);
  const start = page.getByRole("button", { name: "Start recording" });
  await timeline.wait(() => expect(start).toBeEnabled({ timeout: 2 * 60 * 1000 }));
  await pause(page, 1200);
  await start.click();
  await expect(page.getByText(/Recording/)).toBeVisible();
  const note = page.getByPlaceholder("Explain why you do this step…");
  await note.click();
  await typeSlowly(page, `Task: ${TASK}`);
  await page.getByRole("button", { name: "Note" }).click();
  const screen = page.locator("canvas:not(.hidden)");
  await clickOnScreen(page, screen, 650, 62, 3);
  await typeSlowly(page, INVOICES);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Opened Northwind Payables/)).toBeVisible({ timeout: 60 * 1000 });
  await pause(page, 1200);
  await clickOnScreen(page, screen, 312, 303);
  await typeSlowly(page, "Acme Supplies");
  await clickOnScreen(page, screen, 312, 379);
  await typeSlowly(page, "INV-2041");
  await clickOnScreen(page, screen, 312, 455);
  await typeSlowly(page, "1240.00");
  await note.click();
  await typeSlowly(page, "I copy each invoice from the list on the right");
  await page.getByRole("button", { name: "Note" }).click();
  await clickOnScreen(page, screen, 202, 531);
  await typeSlowly(page, "2026-10-10");
  await clickOnScreen(page, screen, 312, 579);
  await expect(page.getByText(/Clicked Approve payment/)).toBeVisible({ timeout: 30 * 1000 });
  await pause(page, 1800);
  await page.getByRole("button", { name: "I'm done" }).click();
  await timeline.wait(() => page.waitForURL(/\/recipes\/[^/]+$/, { timeout: 3 * 60 * 1000 }));
  const recipePath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "This is how I understood it. Right?" })).toBeVisible();
  await pause(page, 3500);

  await page.getByRole("button", { name: "Run now" }).scrollIntoViewIfNeeded();
  await pause(page, 800);
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("Started. Follow it in the chat.")).toBeVisible();
  await pause(page, 1500);

  await page.goto("/waiting");
  const card = page.locator("div").filter({ hasText: `${AGENT} asks` }).filter({ has: page.getByRole("button", { name: "Go ahead" }) }).last();
  await timeline.wait(() =>
    expect(async () => {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 4 * 60 * 1000 }),
  );
  await pause(page, 3000);
  await card.getByRole("button", { name: "Go ahead" }).hover();
  await pause(page, 600);
  await card.getByRole("button", { name: "Go ahead" }).click();
  await pause(page, 1500);

  await page.goto(recipePath);
  const runLink = page.locator('a[href^="/runs/"]').first();
  await timeline.wait(() =>
    expect(async () => {
      await page.reload();
      await expect(runLink).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 2 * 60 * 1000 }),
  );
  await runLink.click();
  await page.waitForURL(/\/runs\/[^/]+$/);
  await timeline.wait(() =>
    expect(async () => {
      await page.reload();
      await expect(page.getByText("worked", { exact: true })).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 4 * 60 * 1000 }),
  );
  await pause(page, 2500);
  await page.mouse.wheel(0, 500);
  await pause(page, 2500);
  await page.mouse.wheel(0, 700);
  await pause(page, 2500);

  await page.goto(`${agentPath}/memory`);
  await pause(page, 3500);

  await page.goto(agentPath);
  await say(page, AGENT, `tell ${TEAMMATE}: This week's supplier invoices are paid`);
  await timeline.wait(() => expect(page.getByText(new RegExp(`Told ${TEAMMATE}`))).toBeVisible({ timeout: 2 * 60 * 1000 }));
  await pause(page, 1500);

  await page.goto("/team");
  await page.waitForURL(/\/rooms$/);
  await pause(page, 1500);
  await page.getByRole("link", { name: new RegExp(`(${AGENT}|${TEAMMATE}) and (${AGENT}|${TEAMMATE})`) }).click();
  await page.waitForURL(/\/rooms\/pair\/[^/]+\/[^/]+$/);
  await expect(page.getByText("This week's supplier invoices are paid")).toBeVisible();
  await pause(page, 3500);

  await page.goto("/today");
  await pause(page, 4000);

  const state = await context.storageState();
  await context.close();
  const mainVideo = await page.video()?.path();

  const phone = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: state,
    recordVideo: { dir: test.info().outputPath("phone"), size: PHONE },
  });
  const phonePage = await phone.newPage();
  await phonePage.goto("/today");
  await pause(phonePage, 3000);
  await phonePage.goto("/");
  await pause(phonePage, 2500);
  await phonePage.goto(recipePath);
  await pause(phonePage, 1500);
  await phonePage.mouse.wheel(0, 600);
  await pause(phonePage, 2500);
  await phone.close();
  const phoneVideo = await phonePage.video()?.path();

  writeFileSync(test.info().outputPath("timeline.json"), JSON.stringify({ mainVideo, phoneVideo, marks: timeline.marks }, null, 2));
});
