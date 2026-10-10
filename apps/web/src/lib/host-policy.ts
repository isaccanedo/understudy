export type HostAdmission = "trusted" | "pin" | "refuse";

export function hostAdmission(input: { hostId: string; allowlist: string[]; known: { trusted: boolean } | null; anyTrusted: boolean }): HostAdmission {
  if (input.allowlist.length > 0) return input.allowlist.includes(input.hostId) ? "trusted" : "refuse";
  if (input.known) return input.known.trusted ? "trusted" : "refuse";
  return input.anyTrusted ? "refuse" : "pin";
}

export function canPlaceOn(agentHostId: string | null, hostId: string) {
  return agentHostId === null || agentHostId === hostId;
}

export type HostRemoval = "ok" | "connected" | "running" | "missing";

export function hostRemoval(host: { exists: boolean; connected: boolean; agents: number }): HostRemoval {
  if (!host.exists) return "missing";
  if (host.connected) return "connected";
  if (host.agents > 0) return "running";
  return "ok";
}

export type HostName = { kind: "cloud"; ip: string } | { kind: "numbered"; n: string } | { kind: "raw"; id: string };

export function hostName(id: string): HostName {
  const cloud = /^ip-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})(?:\b|\.|$)/.exec(id);
  if (cloud) return { kind: "cloud", ip: cloud.slice(1, 5).join(".") };
  const numbered = /^[a-z][\w-]*-host-(\d+)$/i.exec(id) ?? /^host-(\d+)$/i.exec(id);
  if (numbered) return { kind: "numbered", n: numbered[1] };
  return { kind: "raw", id };
}
