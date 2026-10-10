import { execFile } from "node:child_process";
import type { ComputerSpec, HostToServer } from "@understudy/protocol";
import { expectOk, type DockerClient } from "./docker.ts";
import { log } from "@understudy/runtime";

export type ComputerStatus = Extract<HostToServer, { type: "computer_status" }>["status"];

export type Limits = {
  memoryBytes: number;
  nanoCpus: number;
  shmBytes: number;
  pidsLimit: number;
  network: string;
  extraEnv: string[];
  extraHosts: string[];
};

export const DEFAULT_LIMITS: Limits = {
  memoryBytes: 3 * 1024 ** 3,
  nanoCpus: 2_000_000_000,
  shmBytes: 1024 ** 3,
  pidsLimit: 2048,
  network: "understudy-agents",
  extraEnv: [],
  extraHosts: [],
};

export function parseExtraHosts(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^[A-Za-z0-9.-]+:(host-gateway|[0-9A-Fa-f:.]+)$/.test(entry));
}

export const ISOLATED_NETWORK_OPTIONS = { "com.docker.network.bridge.enable_icc": "false" };

const MANAGED_LABEL = "understudy.managed";
const AGENT_LABEL = "understudy.agent";
const HOME = "/home/agent";

export function safeId(agentId: string): string {
  const cleaned = agentId.replace(/[^a-zA-Z0-9_.-]/g, "-");
  if (!cleaned || cleaned !== agentId) throw new Error(`invalid agent id: ${JSON.stringify(agentId)}`);
  return cleaned;
}

export const ROLE_LABEL = "understudy.role";

export function benchName(agentId: string): string {
  return `bench-${safeId(agentId)}`;
}

export function benchVolumeName(agentId: string): string {
  return `agent-${safeId(agentId)}-bench`;
}

export function containerName(agentId: string): string {
  return `agent-${safeId(agentId)}`;
}

export function volumeName(agentId: string): string {
  return `agent-${safeId(agentId)}-home`;
}

export function computerEnv(spec: ComputerSpec, extraEnv: string[] = []): string[] {
  return [`AGENT_ID=${spec.agentId}`, `AGENT_TOKEN=${spec.token}`, `UNDERSTUDY_SERVER_URL=${spec.serverUrl}`, ...extraEnv];
}

export function passthroughEnv(names: string, env: NodeJS.ProcessEnv): string[] {
  return names
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[A-Z_][A-Z0-9_]*$/.test(name) && !["AGENT_ID", "AGENT_TOKEN", "UNDERSTUDY_SERVER_URL"].includes(name) && env[name] !== undefined)
    .map((name) => `${name}=${env[name]}`);
}

export function createBody(spec: ComputerSpec, limits: Limits = DEFAULT_LIMITS) {
  if (["host", "none", "bridge", "default"].includes(limits.network) || limits.network.startsWith("container:")) {
    throw new Error(`computers run only on an isolated network, not ${limits.network}`);
  }
  return {
    Image: spec.image,
    Hostname: "understudy",
    Env: computerEnv(spec, limits.extraEnv),
    Labels: { [MANAGED_LABEL]: "true", [AGENT_LABEL]: spec.agentId },
    HostConfig: {
      Binds: [`${volumeName(spec.agentId)}:${HOME}`],
      RestartPolicy: { Name: "unless-stopped" },
      Memory: limits.memoryBytes,
      MemorySwap: limits.memoryBytes,
      NanoCpus: limits.nanoCpus,
      ShmSize: limits.shmBytes,
      PidsLimit: limits.pidsLimit,
      Privileged: false,
      NetworkMode: limits.network,
      ...(limits.extraHosts.length ? { ExtraHosts: limits.extraHosts } : {}),
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Init: true,
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
    },
  };
}

type Inspect = {
  Image?: string;
  HostConfig?: { NetworkMode?: string; ExtraHosts?: string[] | null; Binds?: string[] | null };
  Config: { Image: string; Env: string[] };
  State: { Status: string; Running: boolean; ExitCode: number; Error?: string; Restarting?: boolean };
};

export function needsRecreate(inspect: Inspect, spec: ComputerSpec, imageId?: string, extraEnv: string[] = [], network?: string, extraHosts: string[] = []): boolean {
  if (inspect.Config.Image !== spec.image) return true;
  if (inspect.HostConfig?.Binds?.some((bind) => bind.endsWith(":/run/bench"))) return true;
  if (inspect.HostConfig && [...(inspect.HostConfig.ExtraHosts ?? [])].sort().join(",") !== [...extraHosts].sort().join(",")) return true;
  if (network && inspect.HostConfig?.NetworkMode && inspect.HostConfig.NetworkMode !== network) return true;
  if (imageId && inspect.Image && inspect.Image !== imageId) return true;
  const env = new Set(inspect.Config.Env ?? []);
  const wanted = computerEnv(spec, extraEnv);
  if (wanted.some((entry) => !env.has(entry))) return true;
  const wantedNames = new Set(wanted.map((entry) => entry.split("=")[0]));
  const managedBefore = (inspect.Config.Env ?? []).filter((entry) => /^(ANTHROPIC|OPENAI|CODEX)_/.test(entry));
  return managedBefore.some((entry) => !wantedNames.has(entry.split("=")[0]));
}

export function statusFromState(state: { Status: string; ExitCode?: number; Restarting?: boolean }): ComputerStatus {
  if (state.Status === "running") return "running";
  if (state.Status === "created" || state.Status === "restarting") return "starting";
  if (state.Status === "exited" && state.ExitCode && state.ExitCode !== 0 && state.ExitCode !== 143 && state.ExitCode !== 137) return "failed";
  if (state.Status === "dead") return "failed";
  return "stopped";
}

export function resolveSpec(requested: ComputerSpec, allowedImage?: string): ComputerSpec {
  if (allowedImage) {
    if (requested.image && requested.image !== allowedImage) {
      throw new Error(`refusing image ${requested.image}: this host only runs ${allowedImage}`);
    }
    return { ...requested, image: allowedImage };
  }
  if (!requested.image) throw new Error("no computer image: set UNDERSTUDY_COMPUTER_IMAGE on the host or send spec.image");
  return requested;
}

export type RegistryAuth = () => Promise<string | null>;

export function registryAuthFromEnv(env: NodeJS.ProcessEnv): RegistryAuth {
  if (env.UNDERSTUDY_REGISTRY_AUTH) {
    const value = env.UNDERSTUDY_REGISTRY_AUTH;
    return async () => value;
  }
  if (env.UNDERSTUDY_REGISTRY_PASSWORD_COMMAND && env.UNDERSTUDY_REGISTRY_SERVER) {
    const command = env.UNDERSTUDY_REGISTRY_PASSWORD_COMMAND;
    const username = env.UNDERSTUDY_REGISTRY_USER || "AWS";
    const serveraddress = env.UNDERSTUDY_REGISTRY_SERVER;
    return () =>
      new Promise((resolve) => {
        execFile("/bin/sh", ["-c", command], { timeout: 60000 }, (error, stdout) => {
          if (error) {
            log("registry", `password command failed: ${error.message}`);
            resolve(null);
            return;
          }
          resolve(Buffer.from(JSON.stringify({ username, password: stdout.trim(), serveraddress })).toString("base64url"));
        });
      });
  }
  return async () => null;
}

export type Supervisor = {
  ensure: (spec: ComputerSpec) => Promise<void>;
  stop: (agentId: string) => Promise<void>;
  destroy: (agentId: string) => Promise<void>;
  running: () => Promise<string[]>;
  retireOutdated: () => Promise<string[]>;
  sweep: () => Promise<void>;
};

export function createSupervisor(options: {
  docker: DockerClient;
  report: (agentId: string, status: ComputerStatus, message?: string) => void;
  limits?: Limits;
  registryAuth?: RegistryAuth;
  alwaysPull?: boolean;
  imageOverride?: string;
  capacity?: number;
}): Supervisor {
  const { docker } = options;
  const limits = options.limits ?? DEFAULT_LIMITS;
  const chains = new Map<string, Promise<void>>();
  const lastReported = new Map<string, ComputerStatus>();

  const report = (agentId: string, status: ComputerStatus, message?: string) => {
    lastReported.set(agentId, status);
    options.report(agentId, status, message);
  };

  const serialize = (agentId: string, work: () => Promise<void>) => {
    const previous = chains.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    chains.set(agentId, next);
    void next.finally(() => {
      if (chains.get(agentId) === next) chains.delete(agentId);
    }).catch(() => {});
    return next;
  };

  const imageId = async (image: string): Promise<string | undefined> => {
    const response = await docker("GET", `/images/${encodeURIComponent(image)}/json`);
    if (response.status !== 200) return undefined;
    return JSON.parse(response.body).Id;
  };

  const pull = async (image: string) => {
    const present = await docker("GET", `/images/${encodeURIComponent(image)}/json`);
    if (present.status === 200 && !options.alwaysPull) return;
    const auth = await (options.registryAuth ?? (async () => null))();
    log("docker", `pulling ${image}`);
    const response = expectOk(await docker("POST", `/images/create?fromImage=${encodeURIComponent(image)}`, undefined, auth ? { "X-Registry-Auth": auth } : {}));
    const failure = response.body
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line).error as string | undefined;
        } catch {
          return undefined;
        }
      })
      .find(Boolean);
    if (failure) {
      if (present.status === 200) {
        log("docker", `pull failed, keeping the local image: ${failure}`);
        return;
      }
      throw new Error(`pull failed: ${failure}`);
    }
  };

  const inspect = async (name: string): Promise<Inspect | null> => {
    const response = await docker("GET", `/containers/${name}/json`);
    if (response.status === 404) return null;
    return JSON.parse(expectOk(response).body);
  };

  const reserved = new Set<string>();
  let seatGate: Promise<void> = Promise.resolve();

  const reserveSeat = (agentId: string) => {
    const capacity = options.capacity;
    if (capacity === undefined) return Promise.resolve();
    const attempt = seatGate.then(async () => {
      const running = (await list()).filter((entry) => entry.state === "running").map((entry) => entry.agentId);
      const taken = new Set([...running, ...reserved]);
      taken.delete(agentId);
      if (taken.size >= capacity) throw new Error(`host is full (${taken.size} of ${capacity} computers)`);
      reserved.add(agentId);
    });
    seatGate = attempt.catch(() => {});
    return attempt;
  };

  let networkReady = false;
  const ensureNetwork = async () => {
    if (networkReady) return;
    const found = await docker("GET", `/networks/${encodeURIComponent(limits.network)}`);
    if (found.status === 404) {
      expectOk(
        await docker("POST", "/networks/create", {
          Name: limits.network,
          Driver: "bridge",
          CheckDuplicate: true,
          Options: ISOLATED_NETWORK_OPTIONS,
          Labels: { [MANAGED_LABEL]: "true" },
        }),
        [409],
      );
    } else {
      const network = JSON.parse(expectOk(found).body) as { Driver?: string; Options?: Record<string, string> };
      if (network.Options?.["com.docker.network.bridge.enable_icc"] !== "false") {
        throw new Error(`network ${limits.network} lets containers reach each other; refusing to use it`);
      }
    }
    networkReady = true;
  };

  const retireBench = async (agentId: string) => {
    expectOk(await docker("DELETE", `/containers/${benchName(agentId)}?force=true`), [404]);
    expectOk(await docker("DELETE", `/volumes/${benchVolumeName(agentId)}?force=true`), [404, 409]);
  };

  const ensure = async (requested: ComputerSpec) => {
    const spec = resolveSpec(requested, options.imageOverride);
    const name = containerName(spec.agentId);
    report(spec.agentId, "starting");
    const existing = await inspect(name);
    if (!existing?.State.Running) await reserveSeat(spec.agentId);
    await ensureNetwork();
    await pull(spec.image);
    const wanted = await imageId(spec.image);
    expectOk(await docker("POST", "/volumes/create", { Name: volumeName(spec.agentId), Labels: { [MANAGED_LABEL]: "true", [AGENT_LABEL]: spec.agentId } }));
    let current = existing;
    if (current && needsRecreate(current, spec, wanted, limits.extraEnv, limits.network, limits.extraHosts)) {
      log("docker", `recreating ${name} (image or settings changed)`);
      expectOk(await docker("DELETE", `/containers/${name}?force=true`), [404]);
      current = null;
    }
    if (!current) {
      expectOk(await docker("POST", `/containers/create?name=${name}`, createBody(spec, limits)));
    }
    expectOk(await docker("POST", `/containers/${name}/start`), [304]);
    await retireBench(spec.agentId).catch((error) => log("supervisor", `${spec.agentId}: could not remove the old workbench: ${(error as Error).message}`));
    const after = await inspect(name);
    if (!after) throw new Error("container vanished after start");
    const status = statusFromState(after.State);
    report(spec.agentId, status === "stopped" ? "failed" : status, after.State.Error || undefined);
  };

  const list = async () => {
    const filters = encodeURIComponent(JSON.stringify({ label: [`${MANAGED_LABEL}=true`] }));
    const response = expectOk(await docker("GET", `/containers/json?all=true&filters=${filters}`));
    return (JSON.parse(response.body) as { Labels: Record<string, string>; State: string; Status: string }[]).filter((entry) => entry.Labels[ROLE_LABEL] !== "workbench").map((entry) => ({
      agentId: entry.Labels[AGENT_LABEL],
      state: entry.State,
      exitCode: Number(entry.Status.match(/Exited \((\d+)\)/)?.[1] ?? 0),
    }));
  };

  const fail = (agentId: string) => (error: unknown) => {
    const message = (error as Error).message;
    log("supervisor", `${agentId}: ${message}`);
    report(agentId, "failed", message);
  };

  return {
    ensure: (spec) =>
      serialize(spec.agentId, () =>
        ensure(spec)
          .catch(fail(spec.agentId))
          .finally(() => reserved.delete(spec.agentId)),
      ),
    stop: (agentId) =>
      serialize(agentId, async () => {
        expectOk(await docker("POST", `/containers/${containerName(agentId)}/stop?t=15`), [304, 404]);
        expectOk(await docker("POST", `/containers/${benchName(agentId)}/stop?t=5`), [304, 404]);
        report(agentId, "stopped");
      }).catch(fail(agentId)),
    destroy: (agentId) =>
      serialize(agentId, async () => {
        expectOk(await docker("DELETE", `/containers/${containerName(agentId)}?force=true`), [404]);
        expectOk(await docker("DELETE", `/containers/${benchName(agentId)}?force=true`), [404]);
        expectOk(await docker("DELETE", `/volumes/${volumeName(agentId)}?force=true`), [404]);
        expectOk(await docker("DELETE", `/volumes/${benchVolumeName(agentId)}?force=true`), [404]);
        lastReported.delete(agentId);
        options.report(agentId, "stopped", "destroyed");
      }).catch(fail(agentId)),
    running: async () => (await list()).filter((entry) => entry.state === "running").map((entry) => entry.agentId),
    retireOutdated: async () => {
      if (!options.imageOverride) return [];
      const wanted = await imageId(options.imageOverride);
      if (!wanted) return [];
      const retired: string[] = [];
      for (const entry of await list()) {
        if (!entry.agentId || entry.state !== "running" || chains.has(entry.agentId)) continue;
        const current = await inspect(containerName(entry.agentId));
        if (!current?.Image || current.Image === wanted) continue;
        await serialize(entry.agentId, async () => {
          expectOk(await docker("POST", `/containers/${containerName(entry.agentId)}/stop?t=15`), [304, 404]);
        });
        log("supervisor", `${entry.agentId}: stopped to move to the new computer image`);
        retired.push(entry.agentId);
      }
      return retired;
    },
    sweep: async () => {
      for (const entry of await list()) {
        if (!entry.agentId || chains.has(entry.agentId)) continue;
        const status = statusFromState({ Status: entry.state, ExitCode: entry.exitCode });
        if (lastReported.get(entry.agentId) === status) continue;
        report(entry.agentId, status);
      }
    },
  };
}
