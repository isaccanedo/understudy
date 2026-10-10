import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const SITE = process.env.E2E_SITE_URL || "http://host.docker.internal:39101/";
const INVOICES = new URL("invoices.html", SITE).toString();
const OUT = fileURLToPath(new URL("../../../docs/media/", import.meta.url));
const ADMIN = { name: "Sam Rivera", email: "sam@northwind.example", password: "demo-admin-password-1" };
const OWNER = { name: "Maya Chen", email: "maya@northwind.example", temporary: "demo-temporary-pass-1", password: "demo-owner-password-1" };
const AGENT = "Ada";
const TEAMMATE = "Ben";
const TASK = "Pay this week's supplier invoices";
const SCREEN_WIDTH = 1440;
const VIEWPORT = { width: 1440, height: 900 };

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}${name}.jpg`, quality: 82 });
}

async function clickOnScreen(page: Page, screen: Locator, x: number, y: number, clickCount = 1) {
  const box = await screen.boundingBox();
  if (!box) throw new Error("the live screen has no size");
  const scale = box.width / SCREEN_WIDTH;
  await page.mouse.click(box.x + x * scale, box.y + y * scale, { clickCount });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function createUnderstudy(page: Page, name: string, purpose: string) {
  await page.goto("/agents/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("What it does, in one sentence").fill(purpose);
  await page.getByRole("button", { name: "Create understudy" }).click();
  await page.waitForURL(/\/agents\/[^/?]+\?tab=settings$/);
  return new URL(page.url()).pathname;
}

test("screenshots for the README", async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);
  mkdirSync(OUT, { recursive: true });

  const setup = await browser.newContext({ viewport: VIEWPORT });
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

  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await signIn(page, OWNER.email, OWNER.temporary);
  await page.getByLabel("Temporary password").fill(OWNER.temporary);
  await page.getByLabel("New password").fill(OWNER.password);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "My understudies" })).toBeVisible();

  await createUnderstudy(page, TEAMMATE, "Files paid invoices and tells accounting");
  await expect(page.getByText("connected as fake-brain")).toBeVisible({ timeout: 5 * 60 * 1000 });
  const agentPath = await createUnderstudy(page, AGENT, "Pays our supplier invoices every Friday");
  await expect(page.getByText("connected as fake-brain")).toBeVisible({ timeout: 5 * 60 * 1000 });

  await page.goto(`${agentPath}/teach`);
  await page.getByRole("link", { name: "Teach on its computer" }).click();
  await page.waitForURL(/\/teach\?mode=remote$/);
  const start = page.getByRole("button", { name: "Start recording" });
  await expect(start).toBeEnabled({ timeout: 2 * 60 * 1000 });
  await start.click();
  await expect(page.getByText(/Recording/)).toBeVisible();
  const note = page.getByPlaceholder("Explain why you do this step…");
  await note.fill(`Task: ${TASK}`);
  await page.getByRole("button", { name: "Note" }).click();
  const screen = page.locator("canvas:not(.hidden)");
  await clickOnScreen(page, screen, 650, 62, 3);
  await page.keyboard.type(INVOICES);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Opened Northwind Payables/)).toBeVisible({ timeout: 60 * 1000 });
  await clickOnScreen(page, screen, 312, 303);
  await page.keyboard.type("Acme Supplies");
  await clickOnScreen(page, screen, 312, 379);
  await page.keyboard.type("INV-2041");
  await clickOnScreen(page, screen, 312, 455);
  await page.keyboard.type("1240.00");
  await note.fill("I copy each invoice from the list on the right");
  await page.getByRole("button", { name: "Note" }).click();
  await clickOnScreen(page, screen, 202, 531);
  await page.keyboard.type("2026-10-10");
  await shoot(page, "teach");
  await clickOnScreen(page, screen, 312, 579);
  await expect(page.getByText(/Clicked Approve payment/)).toBeVisible({ timeout: 30 * 1000 });
  await page.getByRole("button", { name: "I'm done" }).click();
  await page.waitForURL(/\/recipes\/[^/]+$/, { timeout: 3 * 60 * 1000 });
  const recipePath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "This is how I understood it. Right?" })).toBeVisible();
  await shoot(page, "recipe");

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("Started. Follow it in the chat.")).toBeVisible();
  await page.goto(`${agentPath}?tab=computer`);
  await expect(page.locator("canvas:not(.hidden)")).toBeVisible({ timeout: 2 * 60 * 1000 });
  await page.waitForTimeout(6000);
  await shoot(page, "computer");

  await page.goto("/waiting");
  const card = page.locator("div").filter({ hasText: `${AGENT} asks` }).filter({ has: page.getByRole("button", { name: "Go ahead" }) }).last();
  await expect(async () => {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 4 * 60 * 1000 });
  await shoot(page, "approval");
  await card.getByRole("button", { name: "Go ahead" }).click();
  await page.waitForTimeout(3000);

  await page.goto(recipePath);
  const runLink = page.locator('a[href^="/runs/"]').first();
  await expect(async () => {
    await page.reload();
    await expect(runLink).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 2 * 60 * 1000 });
  await runLink.click();
  await page.waitForURL(/\/runs\/[^/]+$/);
  const runPath = new URL(page.url()).pathname;
  await expect(async () => {
    await page.goto("/waiting");
    for (const more of await page.getByRole("button", { name: "Go ahead" }).all()) await more.click();
    await page.goto(runPath);
    await expect(page.getByText("worked", { exact: true })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 4 * 60 * 1000 });
  await shoot(page, "run");

  await page.goto(`${agentPath}/memory`);
  await shoot(page, "memory");

  await page.goto("/");
  await shoot(page, "home");

  await page.goto("/today");
  await shoot(page, "today");

  await context.close();
});
