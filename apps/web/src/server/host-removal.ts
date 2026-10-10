import { hostRemoval, type HostRemoval } from "@/lib/host-policy";

export type HostRemovalDeps = {
  requireAdmin: () => Promise<{ id: string }>;
  hostExists: (hostId: string) => Promise<boolean>;
  isConnected: (hostId: string) => boolean;
  boundAgents: (hostId: string) => Promise<number>;
  deleteHost: (hostId: string) => Promise<void>;
  log?: (line: string) => void;
};

export async function removeStaleHost(deps: HostRemovalDeps, hostId: string): Promise<{ ok: boolean; reason: HostRemoval }> {
  const admin = await deps.requireAdmin();
  const reason = hostRemoval({
    exists: await deps.hostExists(hostId),
    connected: deps.isConnected(hostId),
    agents: await deps.boundAgents(hostId),
  });
  if (reason !== "ok") return { ok: false, reason };
  await deps.deleteHost(hostId);
  deps.log?.(JSON.stringify({ event: "host_removed", hostId, by: admin.id }));
  return { ok: true, reason };
}
