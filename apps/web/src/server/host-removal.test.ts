import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostRemoval } from "@/lib/host-policy";
import { removeStaleHost, type HostRemovalDeps } from "./host-removal";

function fakes(overrides: Partial<HostRemovalDeps> & { connected?: boolean; agents?: number; exists?: boolean } = {}) {
  const deleted: string[] = [];
  const deps: HostRemovalDeps = {
    requireAdmin: async () => ({ id: "admin-1" }),
    hostExists: async () => overrides.exists ?? true,
    isConnected: () => overrides.connected ?? false,
    boundAgents: async () => overrides.agents ?? 0,
    deleteHost: async (id) => {
      deleted.push(id);
    },
    ...overrides,
  };
  return { deps, deleted };
}

describe("hostRemoval", () => {
  it("allows only a known machine that is offline and runs nothing", () => {
    assert.equal(hostRemoval({ exists: true, connected: false, agents: 0 }), "ok");
    assert.equal(hostRemoval({ exists: true, connected: true, agents: 0 }), "connected");
    assert.equal(hostRemoval({ exists: true, connected: false, agents: 2 }), "running");
    assert.equal(hostRemoval({ exists: false, connected: false, agents: 0 }), "missing");
  });
});

describe("removeStaleHost", () => {
  it("deletes a stale machine record", async () => {
    const { deps, deleted } = fakes();
    assert.deepEqual(await removeStaleHost(deps, "ip-10-0-0-1"), { ok: true, reason: "ok" });
    assert.deepEqual(deleted, ["ip-10-0-0-1"]);
  });

  it("never deletes a connected machine", async () => {
    const { deps, deleted } = fakes({ connected: true });
    assert.deepEqual(await removeStaleHost(deps, "host-1"), { ok: false, reason: "connected" });
    assert.deepEqual(deleted, []);
  });

  it("keeps a machine that still has understudies on it", async () => {
    const { deps, deleted } = fakes({ agents: 1 });
    assert.deepEqual(await removeStaleHost(deps, "host-1"), { ok: false, reason: "running" });
    assert.deepEqual(deleted, []);
  });

  it("stops before touching anything when the caller is not an admin", async () => {
    let looked = false;
    const { deps, deleted } = fakes({
      requireAdmin: async () => {
        throw new Error("NEXT_REDIRECT");
      },
      hostExists: async () => {
        looked = true;
        return true;
      },
    });
    await assert.rejects(removeStaleHost(deps, "ip-10-0-0-1"), /NEXT_REDIRECT/);
    assert.equal(looked, false);
    assert.deepEqual(deleted, []);
  });
});
