import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { backoffDelay, openLink } from "./index.ts";

test("backoff grows and caps at thirty seconds", () => {
  assert.equal(backoffDelay(0, () => 0), 500);
  assert.equal(backoffDelay(3, () => 1), 8000);
  assert.equal(backoffDelay(20, () => 1), 30000);
});

test("the link sends the bearer token and only delivers messages its parser accepts", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as { port: number }).port;
  let authorization = "";
  server.on("connection", (socket, request) => {
    authorization = request.headers.authorization ?? "";
    socket.send("not json");
    socket.send(JSON.stringify({ type: "bad" }));
    socket.send(JSON.stringify({ type: "good", n: 1 }));
  });
  const received: unknown[] = [];
  await new Promise<void>((resolve) => {
    const link = openLink<{ type: "good"; n: number }, object>({
      url: `ws://127.0.0.1:${port}`,
      token: "secret",
      parse: (raw) => {
        try {
          const value = JSON.parse(String(raw));
          return value.type === "good" ? { ok: true, message: value } : { ok: false, error: "not good" };
        } catch {
          return { ok: false, error: "not JSON" };
        }
      },
      onOpen: () => {},
      onMessage: (message) => {
        received.push(message);
        link.close();
        resolve();
      },
    });
  });
  server.close();
  assert.equal(authorization, "Bearer secret");
  assert.deepEqual(received, [{ type: "good", n: 1 }]);
});

test("the link keeps retrying after the server refuses the upgrade", async () => {
  let refusals = 0;
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => {
    if (refusals < 1) {
      refusals++;
      socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => ws.send(JSON.stringify({ type: "good", n: 2 })));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const received = await new Promise<unknown>((resolve) => {
    const link = openLink<{ type: "good"; n: number }, object>({
      url: `ws://127.0.0.1:${port}`,
      token: "secret",
      parse: (raw) => ({ ok: true, message: JSON.parse(String(raw)) }),
      onOpen: () => {},
      onMessage: (message) => {
        link.close();
        resolve(message);
      },
    });
  });
  wss.close();
  server.close();
  assert.equal(refusals, 1);
  assert.deepEqual(received, { type: "good", n: 2 });
});
