import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DESKTOP_APPS, INSTALL_APP } from "./apps.ts";
import { DOCK_APPS, openAppScript, OPENBOX_MENU, tint2Config } from "./desktop.ts";
import { HOME_HOST, launchAllowed, renderHome, startHome, statusLine } from "./home.ts";

const profile = { name: "Pip", ownerName: "<Ana>", look: { body: "cloud", color: "#FF8A3D", eyes: "happy", acc: "none" } };

function call(method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: 7690, method, path, headers: { host: HOME_HOST, ...headers } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the home page greets the owner, shows the agent and marks apps that still need installing", () => {
  const html = renderHome(profile, "calm", undefined, "/home/agent", (path) => path.includes("blender"));
  assert.match(html, /Welcome back, &lt;Ana&gt;/);
  assert.ok(!html.includes("<Ana>"));
  assert.match(html, /<title>Pip<\/title>/);
  assert.match(html, /This is my computer/);
  assert.match(html, /<svg viewBox="-128 -128 256 256"/);
  for (const app of DESKTOP_APPS) assert.match(html, new RegExp(`data-app="${app.id}"`));
  assert.match(html, /Vector · get/);
  assert.match(html, /Photo · get/);
  assert.ok(!html.includes("3D · get"));
});

test("the status line says what the agent is doing in plain words", () => {
  assert.equal(statusLine("calm"), "Idle, ready for the next task");
  assert.equal(statusLine("working", "  rendering   the mascot "), "Working · rendering the mascot");
  assert.equal(statusLine("waiting_you", "ignored"), "Waiting for you");
});

test("only the home page itself can open programs", () => {
  const ok = { method: "POST", headers: { host: HOME_HOST, "x-understudy-home": "1", origin: `http://${HOME_HOST}` } };
  assert.equal(launchAllowed(ok), true);
  assert.equal(launchAllowed({ ...ok, method: "GET" }), false);
  assert.equal(launchAllowed({ ...ok, headers: { ...ok.headers, "x-understudy-home": undefined } }), false);
  assert.equal(launchAllowed({ ...ok, headers: { ...ok.headers, origin: "https://evil.example" } }), false);
  assert.equal(launchAllowed({ ...ok, headers: { ...ok.headers, host: "evil.example:7690" } }), false);
});

test("the home server serves the page and opens an app through open-app", async () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const log = join(home, "opened");
  writeFileSync(join(bin, "open-app"), `#!/bin/sh\necho "$@" >> ${log}\n`);
  chmodSync(join(bin, "open-app"), 0o755);
  const page = startHome(home, { PATH: `${bin}:/usr/bin:/bin`, HOME: home });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    page.setProfile(profile);
    page.setState("working", "making slides");
    const index = await call("GET", "/");
    assert.equal(index.status, 200);
    assert.match(index.body, /Welcome back, &lt;Ana&gt;/);
    const status = JSON.parse((await call("GET", "/status")).body);
    assert.equal(status.line, "Working · making slides");
    assert.equal(status.hello, "Welcome back, <Ana>");
    assert.equal(status.title, "Pip");
    assert.equal((await call("POST", "/launch/terminal")).status, 403);
    assert.equal((await call("POST", "/launch/terminal", { host: "evil.example" })).status, 421);
    assert.equal((await call("POST", "/launch/nope", { "x-understudy-home": "1" })).status, 403);
    assert.equal((await call("POST", "/launch/terminal", { "x-understudy-home": "1", origin: `http://${HOME_HOST}` })).status, 204);
    for (let tries = 0; tries < 40 && !existsSync(log); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(readFileSync(log, "utf8").trim(), "terminal");
    assert.equal(JSON.parse(readFileSync(join(home, ".understudy", "profile.json"), "utf8")).ownerName, "<Ana>");
  } finally {
    page.close();
  }
});

test("open-app runs an installed app and offers to install a missing one", () => {
  const home = mkdtempSync(join(tmpdir(), "apps-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const log = join(home, "ran");
  for (const name of ["lxterminal", "pcmanfm"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${log}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const script = join(home, "open-app");
  writeFileSync(script, openAppScript(home));
  chmodSync(script, 0o755);
  const env = { PATH: `${bin}:/usr/bin:/bin` };
  execFileSync(script, ["files"], { env });
  execFileSync(script, ["inkscape"], { env });
  mkdirSync(join(home, ".local", "opt", "blender"), { recursive: true });
  writeFileSync(join(home, ".local", "opt", "blender", "blender"), `#!/bin/sh\necho "blender $*" >> ${log}\n`);
  chmodSync(join(home, ".local", "opt", "blender", "blender"), 0o755);
  execFileSync(script, ["blender", "-b", "scene file.blend"], { env });
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
    `pcmanfm ${home}/files`,
    "lxterminal --title=Installing Inkscape -e install-app inkscape --open",
    "blender -b scene file.blend",
  ]);
  assert.equal(spawnSync(script, ["nope"], { env }).status, 2);
});

test("install-app refuses unknown apps and pins every download to a checksum", () => {
  assert.equal(spawnSync("sh", ["-c", INSTALL_APP, "install-app", "nope"]).status, 2);
  const sums = INSTALL_APP.match(/"[0-9a-f]{64}"/g) ?? [];
  assert.equal(sums.length, 3);
  assert.ok(!INSTALL_APP.includes("_SHA__"));
});

test("the dock floats, holds the everyday apps and the menu reaches every app", () => {
  const config = tint2Config("/home/agent");
  assert.match(config, /panel_shrink = 1/);
  assert.ok(config.indexOf("background_color") < config.indexOf("panel_background_id"));
  assert.equal(config.match(/launcher_item_app/g)?.length, DOCK_APPS.length);
  for (const app of DESKTOP_APPS) assert.match(OPENBOX_MENU, new RegExp(`open-app ${app.id}<`));
});

test("the screen speeds up while someone is using the mouse and calms down after", async () => {
  const { frameGate, INTERACTIVE_WINDOW_MS } = await import("./desktop.ts");
  let clock = 0;
  const gate = frameGate(() => clock);
  const sentOver = (ms: number) => {
    let sent = 0;
    for (const end = clock + ms; clock < end; clock += 1000 / 15) if (gate.shouldSend()) sent++;
    return sent;
  };
  assert.ok(sentOver(1000) <= 6);
  gate.touched();
  assert.ok(sentOver(1000) >= 14);
  clock += INTERACTIVE_WINDOW_MS;
  assert.ok(sentOver(1000) <= 6);
});
