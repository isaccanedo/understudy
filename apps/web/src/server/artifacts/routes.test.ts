import assert from "node:assert/strict";
import { test } from "node:test";
import { contentHeaders, matchContentRoute } from "./routes";

test("content routes take a token and an optional page", () => {
  assert.deepEqual(matchContentRoute("GET", "/api/artifacts/c/abc.123.sig"), { token: "abc.123.sig", page: null });
  assert.deepEqual(matchContentRoute("HEAD", "/api/artifacts/c/abc.123.sig/page/4"), { token: "abc.123.sig", page: 4 });
  assert.equal(matchContentRoute("POST", "/api/artifacts/c/abc.123.sig"), null);
  assert.equal(matchContentRoute("GET", "/api/artifacts/c/abc/page/x"), null);
  assert.equal(matchContentRoute("GET", "/api/artifacts/c/abc/other/1"), null);
  assert.equal(matchContentRoute("GET", "/api/artifacts/c/"), null);
});

test("HTML is served sandboxed, framed only by the panel and with no network", () => {
  const headers = contentHeaders("html", "app.html", false, ["https://bot.example.com"]);
  assert.equal(headers["Content-Type"], "text/html; charset=utf-8");
  assert.match(headers["Content-Security-Policy"], /^sandbox allow-scripts;/);
  assert.match(headers["Content-Security-Policy"], /connect-src 'none'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors https:\/\/bot\.example\.com/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
});

test("downloads, office originals and SVGs never run as documents", () => {
  for (const [kind, name, download] of [
    ["html", "app.html", true],
    ["pages", "deck.pptx", false],
  ] as const) {
    const headers = contentHeaders(kind, name, download, []);
    assert.equal(headers["Content-Type"], "application/octet-stream");
    assert.match(headers["Content-Disposition"], /^attachment;/);
    assert.match(headers["Content-Security-Policy"], /sandbox$/);
  }
  const svg = contentHeaders("image", "chart.svg", false, []);
  assert.equal(svg["Content-Type"], "image/svg+xml");
  assert.match(svg["Content-Security-Policy"], /default-src 'none'.*sandbox$/);
  assert.ok(!svg["Content-Security-Policy"].includes("script"));
  const md = contentHeaders("markdown", "brief.md", false, []);
  assert.equal(md["Content-Type"], "text/plain; charset=utf-8");
});
