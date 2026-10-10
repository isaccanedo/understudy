import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { assertPublicUrl, guardedLookup, isPublicAddress, safeFetch } from "./safe-fetch";

test("private, loopback, link-local, CGNAT and metadata addresses are not public", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("extra blocked ranges come from the environment", () => {
  process.env.UNDERSTUDY_BLOCKED_CIDRS = "8.8.8.0/24";
  try {
    assert.equal(isPublicAddress("8.8.8.8"), false);
    assert.equal(isPublicAddress("1.1.1.1"), true);
  } finally {
    delete process.env.UNDERSTUDY_BLOCKED_CIDRS;
  }
});

test("literal private hosts and cluster names are refused before connecting", () => {
  for (const url of ["http://127.0.0.1/mcp", "http://[::1]/mcp", "http://169.254.169.254/latest", "http://svc.ns.svc.cluster.local/mcp", "http://localhost:3000", "file:///etc/passwd"]) {
    assert.throws(() => assertPublicUrl(url), url);
  }
  assert.doesNotThrow(() => assertPublicUrl("https://mcp.example.com/mcp"));
});

test("a name that resolves to a private address is refused at connect time", async () => {
  const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup("localhost", {}, (err) => resolve(err)));
  assert.equal(error?.code, "EPRIVATEADDR");
});

test("the fetch used for upstream servers never reaches a local listener", async () => {
  let hits = 0;
  const server = createServer((_, res) => {
    hits += 1;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`));
    await assert.rejects(safeFetch(`http://localtest.me:${port}/`));
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});
