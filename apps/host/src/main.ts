import { totalmem, hostname } from "node:os";
import { parseServerToHost, PATHS, type HostToServer, type ServerToHost } from "@understudy/protocol";
import { createSupervisor, DEFAULT_LIMITS, parseExtraHosts, passthroughEnv, registryAuthFromEnv } from "./computers.ts";
import { dockerClient } from "./docker.ts";
import { log, openLink } from "@understudy/runtime";

const SWEEP_MS = 20000;

export function hostSocketUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, "").replace(/^http/, "ws")}${PATHS.hostSocket}`;
}

export function defaultCapacity(memoryBytes: number): number {
  return Math.max(1, Math.floor((memoryBytes - 2 * 1024 ** 3) / DEFAULT_LIMITS.memoryBytes));
}

const serverUrl = process.env.UNDERSTUDY_SERVER_URL;
const token = process.env.UNDERSTUDY_HOST_TOKEN;
if (!serverUrl || !token) {
  log("host", "UNDERSTUDY_SERVER_URL and UNDERSTUDY_HOST_TOKEN are required");
  process.exit(2);
}

const hostId = process.env.UNDERSTUDY_HOST_ID || hostname();
const capacity = Number(process.env.UNDERSTUDY_HOST_CAPACITY) || defaultCapacity(totalmem());
const docker = dockerClient(process.env.DOCKER_SOCKET || "/var/run/docker.sock");

let send: (message: HostToServer) => boolean = () => false;

const supervisor = createSupervisor({
  docker,
  report: (agentId, status, message) => {
    log("host", `${agentId} ${status}${message ? `: ${message}` : ""}`);
    send({ type: "computer_status", agentId, status, ...(message ? { message } : {}) });
  },
  limits: {
    ...DEFAULT_LIMITS,
    network: process.env.UNDERSTUDY_COMPUTER_NETWORK || DEFAULT_LIMITS.network,
    extraEnv: passthroughEnv(process.env.UNDERSTUDY_COMPUTER_ENV || "", process.env),
    extraHosts: parseExtraHosts(process.env.UNDERSTUDY_COMPUTER_EXTRA_HOSTS || ""),
  },
  registryAuth: registryAuthFromEnv(process.env),
  alwaysPull: process.env.UNDERSTUDY_ALWAYS_PULL === "1",
  imageOverride: process.env.UNDERSTUDY_COMPUTER_IMAGE || undefined,
  capacity,
});

const link = openLink<ServerToHost, HostToServer>({
  url: hostSocketUrl(serverUrl),
  token,
  parse: parseServerToHost,
  onOpen: () => {
    void supervisor
      .retireOutdated()
      .catch((error) => {
        log("host", `could not check computer images: ${(error as Error).message}`);
        return [] as string[];
      })
      .then(() => supervisor.running())
      .catch((error) => {
        log("host", `could not list containers: ${(error as Error).message}`);
        return [] as string[];
      })
      .then((running) => link.send({ type: "host_hello", hostId, capacity, running, build: process.env.UNDERSTUDY_VERSION || "dev" }));
  },
  onMessage: (message) => {
    switch (message.type) {
      case "computer_ensure":
        void supervisor.ensure(message.spec);
        return;
      case "computer_stop":
        void supervisor.stop(message.agentId);
        return;
      case "computer_destroy":
        void supervisor.destroy(message.agentId);
        return;
      default:
        log("host", `ignored message ${(message as { type: string }).type}`);
    }
  },
});
send = (message) => link.send(message);

setInterval(() => {
  if (link.isOpen()) void supervisor.sweep().catch((error) => log("host", `sweep failed: ${(error as Error).message}`));
}, SWEEP_MS);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    link.close();
    process.exit(0);
  });
}
