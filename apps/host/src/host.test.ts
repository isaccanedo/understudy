import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComputerSpec } from "@understudy/protocol";
import { parseExtraHosts, passthroughEnv, containerName, createBody, createSupervisor, needsRecreate, statusFromState, volumeName, DEFAULT_LIMITS } from "./computers.ts";
import type { DockerClient } from "./docker.ts";

const spec: ComputerSpec = { agentId: "ag1", token: "secret", image: "understudy-computer:1", serverUrl: "https://panel" };

test("names and container body follow the isolation rules", () => {
  assert.equal(containerName("ag1"), "agent-ag1");
  assert.equal(volumeName("ag1"), "agent-ag1-home");
  assert.throws(() => containerName("../etc"));
  const body = createBody(spec);
  assert.deepEqual(body.Env, ["AGENT_ID=ag1", "AGENT_TOKEN=secret", "UNDERSTUDY_SERVER_URL=https://panel"]);
  assert.equal(body.HostConfig.Privileged, false);
  assert.equal(body.HostConfig.Memory, 3 * 1024 ** 3);
  assert.equal(body.HostConfig.NanoCpus, 2e9);
  assert.equal(body.HostConfig.ShmSize, 1024 ** 3);
  assert.deepEqual(body.HostConfig.RestartPolicy, { Name: "unless-stopped" });
  assert.deepEqual(body.HostConfig.Binds, ["agent-ag1-home:/home/agent"]);
  assert.equal(body.HostConfig.NetworkMode, "understudy-agents");
  for (const network of ["host", "bridge", "none", "container:other"]) assert.throws(() => createBody(spec, { ...DEFAULT_LIMITS, network }));
});

test("recreate only when image or env changed", () => {
  const same = { Config: { Image: spec.image, Env: ["PATH=/x", ...createBody(spec).Env] }, State: { Status: "running", Running: true, ExitCode: 0 } };
  assert.equal(needsRecreate(same, spec), false);
  assert.equal(needsRecreate(same, { ...spec, token: "new" }), true);
  assert.equal(needsRecreate(same, { ...spec, image: "understudy-computer:2" }), true);
  assert.equal(needsRecreate({ ...same, Image: "sha256:old" }, spec, "sha256:new"), true);
  assert.equal(needsRecreate({ ...same, Image: "sha256:new" }, spec, "sha256:new"), false);
});

test("docker state maps to computer status", () => {
  assert.equal(statusFromState({ Status: "running" }), "running");
  assert.equal(statusFromState({ Status: "restarting" }), "starting");
  assert.equal(statusFromState({ Status: "exited", ExitCode: 1 }), "failed");
  assert.equal(statusFromState({ Status: "exited", ExitCode: 0 }), "stopped");
  assert.equal(statusFromState({ Status: "exited", ExitCode: 143 }), "stopped");
});

function fakeDocker(networkOptions: Record<string, string> | null = null) {
  const calls: string[] = [];
  let network = networkOptions;
  const containers = new Map<string, { Config: { Image: string; Env: string[] }; Labels: Record<string, string>; State: { Status: string; Running: boolean; ExitCode: number } }>();
  const docker: DockerClient = async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    const name = path.match(/\/containers\/([^/?]+)/)?.[1];
    if (method === "GET" && path.startsWith("/images/")) return { status: 200, body: "{}" };
    if (method === "GET" && path.startsWith("/networks/")) return network ? { status: 200, body: JSON.stringify({ Options: network }) } : { status: 404, body: "{}" };
    if (method === "POST" && path === "/networks/create") {
      network = (body as { Options: Record<string, string> }).Options;
      return { status: 201, body: "{}" };
    }
    if (method === "POST" && path === "/volumes/create") return { status: 201, body: "{}" };
    if (method === "POST" && path.startsWith("/containers/create")) {
      const created = body as { Image: string; Env: string[]; Labels: Record<string, string> };
      containers.set(path.split("name=")[1], { Config: { Image: created.Image, Env: created.Env }, Labels: created.Labels, State: { Status: "created", Running: false, ExitCode: 0 } });
      return { status: 201, body: "{}" };
    }
    if (method === "POST" && path.endsWith("/start") && name) {
      const found = containers.get(name);
      if (!found) return { status: 404, body: '{"message":"no such container"}' };
      found.State = { Status: "running", Running: true, ExitCode: 0 };
      return { status: 204, body: "" };
    }
    if (method === "POST" && path.includes("/stop") && name) {
      const found = containers.get(name);
      if (!found) return { status: 404, body: "" };
      found.State = { Status: "exited", Running: false, ExitCode: 143 };
      return { status: 204, body: "" };
    }
    if (method === "GET" && path.endsWith("/json") && name) {
      const found = containers.get(name);
      return found ? { status: 200, body: JSON.stringify(found) } : { status: 404, body: "{}" };
    }
    if (method === "DELETE" && name) {
      containers.delete(name);
      return { status: 204, body: "" };
    }
    if (method === "DELETE" && path.startsWith("/volumes/")) return { status: 204, body: "" };
    if (method === "GET" && path.startsWith("/containers/json")) {
      return {
        status: 200,
        body: JSON.stringify([...containers.values()].map((value) => ({ Labels: value.Labels, State: value.State.Status, Status: "Up" }))),
      };
    }
    return { status: 500, body: `{"message":"unexpected ${method} ${path}"}` };
  };
  return { docker, calls, containers };
}

test("supervisor ensures, reuses, recreates, stops and destroys", async () => {
  const { docker, calls, containers } = fakeDocker();
  const reports: string[] = [];
  const supervisor = createSupervisor({ docker, report: (id, status) => reports.push(`${id}:${status}`) });
  await supervisor.ensure(spec);
  assert.deepEqual(reports, ["ag1:starting", "ag1:running"]);
  assert.deepEqual(await supervisor.running(), ["ag1"]);
  calls.length = 0;
  await supervisor.ensure(spec);
  assert.ok(!calls.includes("POST /containers/create"));
  await supervisor.ensure({ ...spec, token: "rotated" });
  assert.ok(calls.includes("DELETE /containers/agent-ag1"));
  assert.ok(containers.get("agent-ag1")?.Config.Env.includes("AGENT_TOKEN=rotated"));
  await supervisor.stop("ag1");
  assert.equal(reports.at(-1), "ag1:stopped");
  await supervisor.destroy("ag1");
  assert.equal(containers.size, 0);
  assert.ok(calls.includes("DELETE /volumes/agent-ag1-home"));
});

test("the host image setting wins over the panel's spec", async () => {
  const { docker, containers } = fakeDocker();
  const supervisor = createSupervisor({ docker, report: () => {}, imageOverride: "registry/understudy-computer:latest" });
  await supervisor.ensure({ ...spec, image: "" });
  assert.equal(containers.get("agent-ag1")?.Config.Image, "registry/understudy-computer:latest");
});

test("the host refuses images it was not configured to run", async () => {
  const { docker, containers } = fakeDocker();
  const reports: string[] = [];
  const supervisor = createSupervisor({ docker, report: (id, status, message) => reports.push(`${id}:${status}:${message ?? ""}`), imageOverride: "registry/understudy-computer:latest" });
  await supervisor.ensure({ ...spec, image: "evil/miner:latest" });
  assert.match(reports.at(-1) ?? "", /^ag1:failed:refusing image evil\/miner:latest/);
  assert.equal(containers.size, 0);
});

test("the host stops at its capacity but keeps ensuring agents already running", async () => {
  const { docker, containers } = fakeDocker();
  const reports: string[] = [];
  const supervisor = createSupervisor({ docker, report: (id, status, message) => reports.push(`${id}:${status}:${message ?? ""}`), capacity: 1 });
  await supervisor.ensure(spec);
  await supervisor.ensure({ ...spec, agentId: "ag2" });
  assert.match(reports.at(-1) ?? "", /^ag2:failed:host is full/);
  assert.ok(!containers.has("agent-ag2"));
  await supervisor.ensure(spec);
  assert.equal(reports.at(-1), "ag1:running:");
});

test("capacity holds when ensures arrive at the same time", async () => {
  const { docker, containers } = fakeDocker();
  const supervisor = createSupervisor({ docker, report: () => {}, capacity: 2 });
  await Promise.all(["a1", "a2", "a3", "a4"].map((agentId) => supervisor.ensure({ ...spec, agentId })));
  assert.equal([...containers.keys()].filter((name) => name.startsWith("agent-")).length, 2);
  assert.equal([...containers.keys()].filter((name) => name.startsWith("bench-")).length, 0);
});

test("computers get an isolated network and never one that lets agents talk", async () => {
  const fresh = fakeDocker();
  await createSupervisor({ docker: fresh.docker, report: () => {} }).ensure(spec);
  assert.ok(fresh.calls.includes("POST /networks/create"));
  const open = fakeDocker({ "com.docker.network.bridge.enable_icc": "true" });
  const reports: string[] = [];
  await createSupervisor({ docker: open.docker, report: (id, status, message) => reports.push(`${status}:${message}`) }).ensure(spec);
  assert.match(reports.at(-1) ?? "", /^failed:network understudy-agents lets containers reach each other/);
  assert.equal(open.containers.size, 0);
});

test("a failing docker call reports failed instead of throwing", async () => {
  const reports: string[] = [];
  const docker: DockerClient = async () => ({ status: 500, body: '{"message":"daemon down"}' });
  const supervisor = createSupervisor({ docker, report: (id, status, message) => reports.push(`${id}:${status}:${message ?? ""}`) });
  await supervisor.ensure(spec);
  assert.equal(reports.at(-1), "ag1:failed:daemon down");
});

test("only named variables pass through to computers, never the agent identity", () => {
  const env = { ANTHROPIC_BASE_URL: "https://gw", ANTHROPIC_AUTH_TOKEN: "k", AGENT_TOKEN: "x", OTHER: "o" };
  assert.deepEqual(passthroughEnv("ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN,AGENT_TOKEN,MISSING,bad-name", env), ["ANTHROPIC_BASE_URL=https://gw", "ANTHROPIC_AUTH_TOKEN=k"]);
  const body = createBody(spec, { ...DEFAULT_LIMITS, extraEnv: ["ANTHROPIC_AUTH_TOKEN=k"] });
  assert.ok(body.Env.includes("ANTHROPIC_AUTH_TOKEN=k"));
  const running = { Config: { Image: spec.image, Env: [...body.Env] }, State: { Status: "running", Running: true, ExitCode: 0 } };
  assert.equal(needsRecreate(running, spec, undefined, ["ANTHROPIC_AUTH_TOKEN=k"]), false);
  assert.equal(needsRecreate(running, spec, undefined, []), true);
});

test("extra hosts are opt-in, validated and trigger a recreate when they change", () => {
  assert.deepEqual(parseExtraHosts(" host.docker.internal:host-gateway, bad entry, db:10.0.0.5,x:y"), ["host.docker.internal:host-gateway", "db:10.0.0.5"]);
  assert.equal("ExtraHosts" in createBody(spec).HostConfig, false);
  const body = createBody(spec, { ...DEFAULT_LIMITS, extraHosts: ["host.docker.internal:host-gateway"] });
  assert.deepEqual((body.HostConfig as { ExtraHosts?: string[] }).ExtraHosts, ["host.docker.internal:host-gateway"]);
  const running = { Config: { Image: spec.image, Env: body.Env }, HostConfig: { NetworkMode: "understudy-agents", ExtraHosts: ["host.docker.internal:host-gateway"] }, State: { Status: "running", Running: true, ExitCode: 0 } };
  assert.equal(needsRecreate(running, spec, undefined, [], "understudy-agents", ["host.docker.internal:host-gateway"]), false);
  assert.equal(needsRecreate(running, spec, undefined, [], "understudy-agents", []), true);
});

test("the terminal lives on the computer itself and the old workbench is retired", async () => {
  const { docker, containers, calls } = fakeDocker();
  containers.set("bench-ag1", { Config: { Image: spec.image, Env: [] }, Labels: { "understudy.role": "workbench", "understudy.agent": "ag1", "understudy.managed": "true" }, State: { Status: "running", Running: true, ExitCode: 0 } });
  const supervisor = createSupervisor({ docker, report: () => {}, capacity: 1 });
  await supervisor.ensure(spec);
  assert.ok(!containers.has("bench-ag1"));
  assert.ok(calls.includes("DELETE /volumes/agent-ag1-bench"));
  assert.deepEqual(await supervisor.running(), ["ag1"]);
  const oldLayout = { Config: { Image: spec.image, Env: [] }, HostConfig: { Binds: ["agent-ag1-home:/home/agent", "agent-ag1-bench:/run/bench"] }, State: { Status: "running", Running: true, ExitCode: 0 } };
  assert.equal(needsRecreate(oldLayout as never, spec), true);
});

test("a host on a new computer image stops the computers still on the old one so they come back updated", async () => {
  const { docker, containers, calls } = fakeDocker();
  const outdated = (await import("./computers.ts")).createSupervisor;
  const imageAware: typeof docker = async (method, path, body) => {
    if (method === "GET" && path.startsWith("/images/")) return { status: 200, body: JSON.stringify({ Id: "sha256:new" }) };
    if (method === "GET" && path.endsWith("/json") && path.includes("/containers/agent-")) {
      const name = path.match(/\/containers\/([^/?]+)/)?.[1] ?? "";
      const found = containers.get(name);
      return found ? { status: 200, body: JSON.stringify({ ...found, Image: name === "agent-old" ? "sha256:old" : "sha256:new" }) } : { status: 404, body: "{}" };
    }
    return docker(method, path, body);
  };
  for (const name of ["agent-old", "agent-fresh"]) {
    containers.set(name, { Config: { Image: "img", Env: [] }, Labels: { "understudy.managed": "true", "understudy.agent": name.slice(6) }, State: { Status: "running", Running: true, ExitCode: 0 } });
  }
  const supervisor = outdated({ docker: imageAware, report: () => {}, capacity: 4, imageOverride: "registry/computer:latest" });
  assert.deepEqual(await supervisor.retireOutdated(), ["old"]);
  assert.ok(calls.includes("POST /containers/agent-old/stop"));
  assert.ok(!calls.includes("POST /containers/agent-fresh/stop"));
  assert.deepEqual(await supervisor.running(), ["fresh"]);
});
