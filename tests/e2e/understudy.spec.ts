import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const SITE = process.env.E2E_SITE_URL || "http://host.docker.internal:39101/";
const ADMIN = { name: "Admin", email: "admin@example.com", password: "admin-password-123" };
const OWNER = { name: "Owner", email: "owner@example.com", temporary: "temporary-pass-123", password: "owner-password-456" };
const PAGE_WIDTH = 1280;

async function clickOnScreen(page: Page, screen: Locator, x: number, y: number) {
  const box = await screen.boundingBox();
  if (!box) throw new Error("the live screen has no size");
  const scale = box.width / PAGE_WIDTH;
  await page.mouse.click(box.x + x * scale, box.y + y * scale);
}

async function say(page: Page, agentName: string, text: string) {
  await expect(page.locator("canvas:not(.hidden)")).toBeVisible({ timeout: 2 * 60 * 1000 });
  const box = page.getByPlaceholder(new RegExp(`Talk to ${agentName}`));
  await expect(async () => {
    if ((await box.inputValue()) === "") await box.fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(box).toHaveValue("", { timeout: 3000 });
  }).toPass({ timeout: 60 * 1000 });
}

async function openTrigger(page: Page, name: string) {
  const row = page.getByRole("button", { name: new RegExp(`^${name}`) });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an owner teaches a task, runs it, approves the irreversible step and sees the run", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();

  await test.step("the first account becomes the admin", async () => {
    await admin.goto("/setup");
    await expect(admin.getByRole("heading", { name: "Create the first account" })).toBeVisible();
    await admin.getByLabel("Your name").fill(ADMIN.name);
    await admin.getByLabel("Email").fill(ADMIN.email);
    await admin.getByLabel("Password").fill(ADMIN.password);
    await admin.getByRole("button", { name: "Create and sign in" }).click();
    await expect(admin.getByRole("heading", { name: "My understudies" })).toBeVisible();
  });

  await test.step("the admin creates an account for the owner", async () => {
    await admin.goto("/admin");
    const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: "Create account" }) });
    await form.getByLabel("Name").fill(OWNER.name);
    await form.getByLabel("Email").fill(OWNER.email);
    await form.getByLabel("Temporary password").fill(OWNER.temporary);
    await form.getByRole("button", { name: "Create account" }).click();
    await expect(admin.getByText(`Account created for ${OWNER.email}`)).toBeVisible();
  });

  const ownerContext = await browser.newContext();
  const page = await ownerContext.newPage();

  await test.step("the owner signs in and chooses a password", async () => {
    await signIn(page, OWNER.email, OWNER.temporary);
    await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();
    await page.getByLabel("Temporary password").fill(OWNER.temporary);
    await page.getByLabel("New password").fill(OWNER.password);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { name: "My understudies" })).toBeVisible();
  });

  let agentPath = "";
  await test.step("the owner creates an agent and its computer comes up with a brain", async () => {
    await page.goto("/agents/new");
    await page.getByLabel("Name").fill("E2E Clerk");
    await page.getByRole("button", { name: "Create understudy" }).click();
    await page.waitForURL(/\/agents\/[^/?]+\?tab=settings$/);
    agentPath = new URL(page.url()).pathname;
    await expect(page.getByText("connected as fake-brain")).toBeVisible({ timeout: 4 * 60 * 1000 });
  });

  await test.step("the live view shows the computer's screen", async () => {
    await page.goto(agentPath);
    await expect(page.locator("canvas:not(.hidden)")).toBeVisible({ timeout: 2 * 60 * 1000 });
  });

  let recipePath = "";
  await test.step("the owner records the task once and gets a recipe", async () => {
    await page.goto(`${agentPath}/teach`);
    await page.getByRole("link", { name: "Teach on its computer" }).click();
    await page.waitForURL(/\/teach\?mode=remote$/);
    const start = page.getByRole("button", { name: "Start recording" });
    await expect(start).toBeEnabled({ timeout: 2 * 60 * 1000 });
    await start.click();
    await expect(page.getByText(/Recording/)).toBeVisible();
    const url = page.getByLabel("URL");
    await url.fill(SITE);
    await url.press("Enter");
    await expect(page.getByText(/Opened Supplier form/)).toBeVisible();
    const screen = page.locator("canvas:not(.hidden)");
    await clickOnScreen(page, screen, 260, 118);
    await page.keyboard.type("Acme Supplies", { delay: 40 });
    await clickOnScreen(page, screen, 260, 198);
    await page.keyboard.type("120", { delay: 40 });
    await page.getByPlaceholder("Explain why you do this step…").fill("Every Friday I pay the supplier");
    await page.getByRole("button", { name: "Note" }).click();
    await clickOnScreen(page, screen, 260, 268);
    await expect(page.getByText(/Clicked Send payment/)).toBeVisible();
    await expect(page.getByText(/Filled in Supplier name/)).toBeVisible();
    await page.getByRole("button", { name: "I'm done" }).click();
    await page.waitForURL(/\/recipes\/[^/]+$/, { timeout: 2 * 60 * 1000 });
    recipePath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: "This is how I understood it. Right?" })).toBeVisible();
  });

  await test.step("the owner runs it now", async () => {
    await page.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByText("Started. Follow it in the chat.")).toBeVisible();
  });

  await test.step("the irreversible step waits for approval and the owner approves it", async () => {
    await page.goto("/waiting");
    const card = page.locator("div").filter({ hasText: "E2E Clerk asks" }).filter({ has: page.getByRole("button", { name: "Go ahead" }) }).last();
    await expect(async () => {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 3 * 60 * 1000 });
    await expect(card).toContainText("Send payment");
    await expect(card).toContainText("Acme Supplies");
    await expect(card).toContainText("120");
    await card.getByRole("button", { name: "Go ahead" }).click();
    await expect(page.getByText("approved").first()).toBeVisible();
  });

  await test.step("the run page shows it worked, with its steps", async () => {
    await page.goto(recipePath);
    const runLink = page.locator('a[href^="/runs/"]').first();
    await expect(async () => {
      await page.reload();
      await expect(runLink).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60 * 1000 });
    await runLink.click();
    await page.waitForURL(/\/runs\/[^/]+$/);
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("worked", { exact: true })).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 3 * 60 * 1000 });
    await expect(page.getByText("What it did")).toBeVisible();
    await expect(page.locator("ol li").first()).toBeVisible();
    await expect(page.getByText(/Send payment/).first()).toBeVisible();
    await expect(page.getByText("Approval: approved")).toBeVisible();
    await expect(page.getByText(/RESULT \{/)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("run-page.png"), fullPage: true });
  });

  await test.step("when the owner refuses, the computer blocks the payment", async () => {
    await page.goto(recipePath);
    await page.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByText("Started. Follow it in the chat.")).toBeVisible();
    await page.goto("/waiting");
    const card = page.locator("div").filter({ hasText: "E2E Clerk asks" }).filter({ has: page.getByRole("button", { name: "Don't" }) }).last();
    await expect(async () => {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 3 * 60 * 1000 });
    await card.getByRole("button", { name: "Don't" }).click();
    const agentId = agentPath.split("/").pop();
    await expect(async () => {
      await page.goto(`/runs?agent=${agentId}&status=failed`);
      await expect(page.locator('a[href^="/runs/"]').first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 3 * 60 * 1000 });
    await page.locator('a[href^="/runs/"]').first().click();
    await expect(page.getByText(/Not approved/).first()).toBeVisible();
    await expect(page.getByText("Approval: denied")).toBeVisible();
  });

  await test.step("the agent's runs list shows the run and links to it", async () => {
    const agentId = agentPath.split("/").pop();
    await page.goto(`/runs?agent=${agentId}`);
    await expect(page.getByRole("heading", { name: "Runs of E2E Clerk" })).toBeVisible();
    const row = page.locator('a[href^="/runs/"]').filter({ hasText: "worked" }).first();
    await expect(row).toContainText("Fake recipe");
    await expect(page.locator('a[href^="/runs/"]').filter({ hasText: "failed" })).toHaveCount(1);
    await page.getByRole("link", { name: "Running" }).click();
    await expect(page.getByText("No runs with this status")).toBeVisible();
    await page.getByRole("link", { name: "All" }).click();
    await page.locator('a[href^="/runs/"]').filter({ hasText: "worked" }).first().click();
    await page.waitForURL(/\/runs\/[^/?]+$/);
    await expect(page.getByText("What it did")).toBeVisible();
    await page.goto(`/runs?agent=${agentId}`);
    await page.screenshot({ path: test.info().outputPath("runs-list.png"), fullPage: true });
  });

  await test.step("an owner rule blocks the site on the computer and the owner is told", async () => {
    const rule = "Never open host.docker.internal.";
    await page.goto(`${agentPath}/setup`);
    await page.getByRole("button", { name: "Rules", exact: true }).click();
    await page.getByRole("button", { name: "Add a rule" }).click();
    await page.getByRole("combobox", { name: "Rules" }).click();
    await page.getByRole("option", { name: "Never open this site" }).click();
    await page.getByRole("textbox", { name: "Never open this site" }).fill("host.docker.internal");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(rule, { exact: true })).toBeVisible();
    await page.goto(recipePath);
    await page.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByText("Started. Follow it in the chat.")).toBeVisible();
    await expect(async () => {
      await page.goto(agentPath);
      await expect(page.getByText(`Blocked by your rule "${rule}"`).first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 3 * 60 * 1000 });
    await page.screenshot({ path: test.info().outputPath("rule-blocked.png") });
    await page.goto(`${agentPath}/setup`);
    await page.getByRole("button", { name: "Rules", exact: true }).click();
    await page.getByRole("button", { name: `Remove: ${rule}` }).click();
    await expect(page.getByRole("button", { name: `Remove: ${rule}` })).toHaveCount(0);
    await expect(page.getByText("Add something it must never do, like paying over a limit or opening a site.")).toBeVisible();
  });

  await test.step("two understudies talk and hand work to each other, shown in Conversations", async () => {
    await page.goto("/agents/new");
    await page.getByLabel("Name").fill("E2E Courier");
    await page.getByRole("button", { name: "Create understudy" }).click();
    await page.waitForURL(/\/agents\/[^/?]+\?tab=settings$/);
    const courierPath = new URL(page.url()).pathname;
    await expect(page.getByText("connected as fake-brain")).toBeVisible({ timeout: 4 * 60 * 1000 });

    await page.goto(agentPath);
    await say(page, "E2E Clerk", "tell E2E Courier: The March invoices are ready");
    await expect(page.getByText(/Told E2E Courier: delivered to E2E Courier/)).toBeVisible({ timeout: 2 * 60 * 1000 });

    await page.goto(courierPath);
    await say(page, "E2E Courier", "hand off Fake recipe to E2E Clerk: invoice 42 for Acme Supplies");
    await expect(page.getByText(/Handed "Fake recipe" to E2E Clerk: E2E Clerk started/)).toBeVisible({ timeout: 2 * 60 * 1000 });

    await page.goto("/team");
    await page.waitForURL(/\/rooms$/);
    const pair = page.getByRole("link", { name: /E2E (Clerk|Courier) and E2E (Clerk|Courier)/ });
    await expect(pair).toBeVisible();
    await pair.click();
    await page.waitForURL(/\/rooms\/pair\/[^/]+\/[^/]+$/);
    const pairPath = new URL(page.url()).pathname;
    await expect(page.getByText("The March invoices are ready")).toBeVisible();
    await expect(page.getByText("Handed off “Fake recipe”")).toBeVisible();
    await expect(page.getByText("invoice 42 for Acme Supplies")).toBeVisible();

    await page.goto("/waiting");
    const card = page.locator("div").filter({ hasText: "E2E Clerk asks" }).filter({ has: page.getByRole("button", { name: "Don't" }) }).last();
    await expect(async () => {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 3 * 60 * 1000 });
    await card.getByRole("button", { name: "Don't" }).click();
    await page.goto(pairPath);
    await expect(page.getByText("The March invoices are ready")).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("button", { name: "Let them talk again" })).toBeVisible();
    await expect(page.getByText("You stopped this conversation.", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("pair-thread.png"), fullPage: true });
    await page.getByRole("button", { name: "Let them talk again" }).click();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  await test.step("a watched page that changes starts the task with what changed", async () => {
    const watchedFile = fileURLToPath(new URL("./site/watch.html", import.meta.url));
    const portal = (rows: string[], stamp: string) =>
      `<!doctype html><meta charset="utf-8"><title>Supplier portal</title><h1>Supplier portal</h1><section><h2>Open invoices</h2><ul>${rows.map((row) => `<li>${row}</li>`).join("")}</ul></section><footer>Rendered ${stamp}</footer>`;
    writeFileSync(watchedFile, portal(["INV-2041 · Acme Supplies · $1,240.00"], "first"));
    try {
      await page.goto(recipePath);
      await expect(async () => {
        const turnOn = page.getByRole("button", { name: "Turn it on" });
        if (await turnOn.isVisible()) await turnOn.click();
        await expect(page.getByRole("button", { name: "Pause task" })).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30 * 1000 });
      await openTrigger(page, "When a page changes");
      await page.getByLabel("Page address").fill(`${SITE}watch.html`);
      await page.getByLabel("Only the part that says (optional)").fill("Open invoices");
      await page.getByRole("button", { name: "Watch", exact: true }).click();
      await expect(page.getByText(/^Watching\./)).toBeVisible();
      await expect(async () => {
        await page.reload();
        await openTrigger(page, "When a page changes");
        await expect(page.getByText(/^Last checked:/)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 2 * 60 * 1000 });

      writeFileSync(watchedFile, portal(["INV-2041 · Acme Supplies · $1,240.00"], "second"));
      await page.getByRole("button", { name: "Watch", exact: true }).click();
      await expect(async () => {
        await page.reload();
        await openTrigger(page, "When a page changes");
        await expect(page.getByText(/^Last checked:/)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 2 * 60 * 1000 });
      await expect(page.getByText(/^Last change seen:/)).toHaveCount(0);

      writeFileSync(watchedFile, portal(["INV-2041 · Acme Supplies · $1,240.00", "INV-7783 · Blue Harbor Logistics · $860.50"], "third"));
      await page.getByRole("button", { name: "Watch", exact: true }).click();
      await expect(async () => {
        await page.reload();
        await openTrigger(page, "When a page changes");
        await expect(page.getByText(/^Last change seen:/)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 2 * 60 * 1000 });

      const agentId = agentPath.split("/").pop();
      await page.goto(`/runs?agent=${agentId}`);
      await page.locator('a[href^="/runs/"]').first().click();
      await page.waitForURL(/\/runs\/[^/?]+$/);
      await expect(page.getByText(/\+ INV-7783 · Blue Harbor Logistics · \$860\.50/)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("watch-run.png"), fullPage: true });

      await page.goto("/waiting");
      const card = page.locator("div").filter({ hasText: "E2E Clerk asks" }).filter({ has: page.getByRole("button", { name: "Don't" }) }).last();
      await expect(async () => {
        await page.reload();
        await expect(card).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 3 * 60 * 1000 });
      await card.getByRole("button", { name: "Don't" }).click();
      await page.goto(recipePath);
      await openTrigger(page, "When a page changes");
      await page.getByRole("button", { name: "Stop watching" }).click();
      await expect(page.getByRole("button", { name: "Stop watching" })).toHaveCount(0);
    } finally {
      rmSync(watchedFile, { force: true });
    }
  });

  await test.step("the owner's terminal runs on the computer, starts at home and survives a reload", async () => {
    await page.goto(`${agentPath}/terminal`);
    await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 60 * 1000 });
    const rows = page.locator(".xterm-rows");
    await page.locator(".xterm").click();
    await page.keyboard.type("echo panel-$((40+2)) in $PWD");
    await page.keyboard.press("Enter");
    await expect(rows).toContainText("panel-42 in /home/agent", { timeout: 30 * 1000 });
    await page.reload();
    await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 60 * 1000 });
    await expect(rows).toContainText("panel-42 in /home/agent", { timeout: 30 * 1000 });
    await page.screenshot({ path: test.info().outputPath("terminal.png") });
  });

  await test.step("a background job the agent starts shows in the Jobs tab and the owner can stop it", async () => {
    await page.goto(agentPath);
    await say(page, "E2E Clerk", 'start a background job "Rebuild the invoice archive": sleep 600');
    await expect(page.getByText(/Started "Rebuild the invoice archive" in the background/)).toBeVisible({ timeout: 2 * 60 * 1000 });
    await page.goto(`${agentPath}/jobs`);
    const row = page.locator("li, tr, div").filter({ hasText: "Rebuild the invoice archive" }).filter({ has: page.getByRole("button", { name: "Stop" }) }).last();
    await expect(row).toBeVisible({ timeout: 60 * 1000 });
    await expect(row).toContainText("running");
    await row.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText(/^stopped · started /)).toBeVisible({ timeout: 60 * 1000 });
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("jobs.png") });
  });

  await adminContext.close();
  await ownerContext.close();
});
