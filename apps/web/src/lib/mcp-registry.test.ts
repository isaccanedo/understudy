import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { iconOf, publisherOf, registrySearchUrl, toCatalog } from "./mcp-registry";

const active = (isLatest = true) => ({ "io.modelcontextprotocol.registry/official": { status: "active", isLatest } });

const payload = {
  servers: [
    { server: { name: "io.github.someone/linear-helper", description: "A helper", remotes: [{ type: "streamable-http", url: "https://helper.example.dev/mcp" }] }, _meta: active() },
    {
      server: { name: "app.linear/linear", title: "Linear", description: "Issues", websiteUrl: "https://linear.app", remotes: [{ type: "streamable-http", url: "https://mcp.linear.app/mcp" }] },
      _meta: active(),
    },
    { server: { name: "app.linear/linear", title: "Linear", remotes: [{ type: "streamable-http", url: "https://old.linear.app/mcp" }] }, _meta: active(false) },
    { server: { name: "io.github.x/local-only", description: "Runs on your laptop", packages: [{}] }, _meta: active() },
    { server: { name: "io.github.x/sse-only", remotes: [{ type: "sse", url: "https://sse.example.dev/sse" }] }, _meta: active() },
    { server: { name: "eu.example/templated", remotes: [{ type: "streamable-http", url: "https://example.eu/mcp/{token}", variables: { token: { isSecret: true } } }] }, _meta: active() },
    { server: { name: "com.example/plain-http", remotes: [{ type: "streamable-http", url: "http://example.com/mcp" }] }, _meta: active() },
    {
      server: { name: "com.stripe/mcp", description: "Payments", remotes: [{ type: "streamable-http", url: "https://mcp.stripe.com", headers: [{ name: "Authorization", isSecret: true }] }] },
      _meta: active(),
    },
    {
      server: { name: "io.github.y/deleted", remotes: [{ type: "streamable-http", url: "https://gone.example.dev/mcp" }] },
      _meta: { "io.modelcontextprotocol.registry/official": { status: "deleted", isLatest: true } },
    },
  ],
};

describe("toCatalog", () => {
  it("keeps only active, latest servers the panel can call over streamable HTTPS without URL secrets", () => {
    assert.deepEqual(
      toCatalog(payload).map((entry) => entry.id),
      ["app.linear/linear", "com.stripe/mcp", "io.github.someone/linear-helper"],
    );
  });

  it("puts the service's own domain first for a matching search", () => {
    assert.equal(toCatalog(payload, "linear")[0].id, "app.linear/linear");
    assert.equal(toCatalog(payload, "stripe")[0].id, "com.stripe/mcp");
  });

  it("fills the address, the key header and a Bearer prefix", () => {
    const stripe = toCatalog(payload).find((entry) => entry.id === "com.stripe/mcp");
    assert.equal(stripe?.url, "https://mcp.stripe.com");
    assert.equal(stripe?.headerName, "Authorization");
    assert.equal(stripe?.headerPrefix, "Bearer ");
    const linear = toCatalog(payload).find((entry) => entry.id === "app.linear/linear");
    assert.equal(linear?.name, "Linear");
    assert.equal(linear?.headerName, undefined);
    assert.equal(linear?.website, "https://linear.app");
  });

  it("names servers without a title from their last segment", () => {
    assert.equal(toCatalog(payload).find((entry) => entry.id.endsWith("linear-helper"))?.name, "Linear Helper");
    assert.equal(toCatalog(payload).find((entry) => entry.id === "com.stripe/mcp")?.name, "Stripe");
  });

  it("survives junk", () => {
    assert.deepEqual(toCatalog(null), []);
    assert.deepEqual(toCatalog({ servers: [null, { server: {} }] }), []);
  });
});

describe("iconOf", () => {
  it("takes the first https image the panel can show", () => {
    assert.equal(
      iconOf([{ src: "http://plain.example/icon.png" }, { src: "https://x.example/icon.ico", mimeType: "image/x-icon" }, { src: "https://x.example/mark.svg", mimeType: "image/svg+xml" }]),
      "https://x.example/mark.svg",
    );
    assert.equal(iconOf([{ src: "https://x.example/a b.png" }]), undefined);
    assert.equal(iconOf("https://x.example/icon.png"), undefined);
    assert.equal(iconOf(undefined), undefined);
  });

  it("is carried into the catalog entry", () => {
    const withIcon = {
      servers: [
        { server: { name: "com.example/mcp", icons: [{ src: "https://example.com/icon.png", mimeType: "image/png" }], remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }] } },
      ],
    };
    assert.equal(toCatalog(withIcon)[0].icon, "https://example.com/icon.png");
  });
});

describe("publisherOf and registrySearchUrl", () => {
  it("reads the verified domain or the GitHub account from the name", () => {
    assert.deepEqual(publisherOf("app.linear/linear"), { kind: "domain", label: "linear.app" });
    assert.deepEqual(publisherOf("io.github.someone/tool"), { kind: "github", label: "someone" });
  });

  it("always asks the official registry for the latest versions", () => {
    const url = new URL(registrySearchUrl("  notion  "));
    assert.equal(url.origin, "https://registry.modelcontextprotocol.io");
    assert.equal(url.searchParams.get("search"), "notion");
    assert.equal(url.searchParams.get("version"), "latest");
  });
});
