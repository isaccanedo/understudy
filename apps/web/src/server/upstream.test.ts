import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.UNDERSTUDY_ALLOW_PRIVATE_MCP = "1";

const KEY = "Bearer sk_test_connector";
let server: Server;
let base = "";

before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/plain") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>hello</html>");
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.headers.authorization !== KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const mcp = new McpServer({ name: "tracker", version: "1" });
    mcp.registerTool("create_issue", { description: "Create an issue", inputSchema: { title: z.string() } }, async () => ({ content: [{ type: "text", text: "ok" }] }));
    mcp.registerTool("list_issues", { description: "List issues", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "[]" }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

async function row(url: string, key?: string) {
  const { seal } = await import("@/lib/secret-box");
  return {
    id: `mcp_${Math.random().toString(36).slice(2)}`,
    name: "Tracker",
    slug: "tracker",
    url,
    headerName: key ? "Authorization" : null,
    headerValue: key ? seal(key) : null,
    askAll: false,
    askTools: [],
    allowedEmails: null,
    oauthClient: null,
    createdBy: null,
    createdAt: new Date(),
  };
}

test("testing a connector lists the actions it offers", async () => {
  const { testConnection } = await import("./upstream");
  const result = await testConnection(await row(`${base}/mcp`, KEY));
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.tools.map((t) => t.name).sort(), ["create_issue", "list_issues"]);
});

test("a wrong key, a wrong path and a non-MCP page each get their own reason", async () => {
  const { testConnection } = await import("./upstream");
  assert.deepEqual(await testConnection(await row(`${base}/mcp`, "Bearer wrong")), { ok: false, problem: "unauthorized" });
  assert.deepEqual(await testConnection(await row(`${base}/nothing`, KEY)), { ok: false, problem: "not_found" });
  const plain = await testConnection(await row(`${base}/plain`));
  assert.equal(plain.ok, false);
  assert.ok(!plain.ok && ["not_mcp", "unreachable"].includes(plain.problem));
});

test("connector problems are classified from the errors the client raises", async () => {
  const { connectorProblem } = await import("./upstream");
  assert.equal(connectorProblem(Object.assign(new Error("Streamable HTTP error: Error POSTing to endpoint (HTTP 401)"), { code: 401 })), "unauthorized");
  assert.equal(connectorProblem(Object.assign(new Error("refused to connect to a private address for db.internal"), { code: "EPRIVATEADDR" })), "private");
  assert.equal(connectorProblem(new TypeError("fetch failed")), "unreachable");
  assert.equal(connectorProblem(new Error("Unexpected content type: text/html")), "not_mcp");
});

test("the Slack manifest asks for what the agent tools need, and missing ones are listed", async () => {
  const { SLACK_BOT_SCOPES, missingScopes } = await import("./slack-app");
  for (const scope of ["chat:write.public", "channels:read", "users:read.email", "files:write", "channels:join", "channels:history"]) assert.ok(SLACK_BOT_SCOPES.includes(scope), scope);
  assert.deepEqual(missingScopes(SLACK_BOT_SCOPES), []);
  assert.deepEqual(missingScopes(SLACK_BOT_SCOPES.filter((s) => s !== "files:write")), ["files:write"]);
});
