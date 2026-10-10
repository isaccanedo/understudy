import { PATHS } from "@understudy/protocol";

export function computerSocketUrl(serverUrl: string, agentId: string): string {
  const base = serverUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  return `${base}${PATHS.computerSocket}?agent=${encodeURIComponent(agentId)}`;
}

export function gatekeeperUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, "")}${PATHS.gatekeeperMcp}`;
}
