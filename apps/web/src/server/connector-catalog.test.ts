import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchCatalog } from "./connector-catalog";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("searchCatalog", () => {
  it("does not call out for one letter", async () => {
    let called = false;
    const result = await searchCatalog("a", (async () => {
      called = true;
      return reply({});
    }) as typeof fetch);
    assert.deepEqual(result, { ok: true, entries: [] });
    assert.equal(called, false);
  });

  it("only calls the official registry and returns remote servers", async () => {
    const urls: string[] = [];
    const result = await searchCatalog("notion-test", (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return reply({ servers: [{ server: { name: "com.notion/mcp", title: "Notion", remotes: [{ type: "streamable-http", url: "https://mcp.notion.com/mcp" }] } }] });
    }) as typeof fetch);
    assert.equal(new URL(urls[0]).origin, "https://registry.modelcontextprotocol.io");
    assert.ok(result.ok);
    assert.equal(result.ok && result.entries[0].url, "https://mcp.notion.com/mcp");
  });

  it("reports a failure instead of throwing when the registry is down", async () => {
    assert.deepEqual(await searchCatalog("down-test", (async () => reply({}, 503)) as typeof fetch), { ok: false });
    assert.deepEqual(await searchCatalog("boom-test", (async () => {
      throw new Error("offline");
    }) as typeof fetch), { ok: false });
  });
});
