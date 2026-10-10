import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogExtras, FEATURED_CONNECTORS, featuredFor, filterFeatured, logoSources, monogram, sameAddress, withPrefix } from "./connector-showcase";
import type { CatalogEntry } from "./mcp-registry";

const entry = (id: string, url: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, name: id, description: "", url, publisher: { kind: "github", label: "someone" }, ...extra });

describe("featured connectors", () => {
  it("are all remote https addresses with a unique id and a category", () => {
    const ids = new Set(FEATURED_CONNECTORS.map((connector) => connector.id));
    assert.equal(ids.size, FEATURED_CONNECTORS.length);
    for (const connector of FEATURED_CONNECTORS) {
      assert.match(connector.url, /^https:\/\//);
      assert.ok(connector.category);
      if (connector.headerName) assert.match(connector.keyPage ?? "", /^https:\/\//);
    }
  });

  it("filters by category and by words in the name, publisher or blurb", () => {
    assert.ok(filterFeatured("", "money").every((connector) => connector.category === "money"));
    assert.deepEqual(
      filterFeatured("linear", "all").map((connector) => connector.id),
      ["linear"],
    );
    assert.deepEqual(
      filterFeatured("invoices", "all", { stripe: "Looks up invoices" }).map((connector) => connector.id),
      ["stripe"],
    );
    assert.equal(filterFeatured("", "all").length, FEATURED_CONNECTORS.length);
    assert.deepEqual(filterFeatured("nothing like this", "all"), []);
  });
});

describe("catalogExtras", () => {
  it("drops what is already on screen and swaps known addresses for the featured card", () => {
    const shown = filterFeatured("linear", "all");
    const extras = catalogExtras(
      [
        entry("app.linear/linear", "https://mcp.linear.app/mcp/"),
        entry("com.stripe/mcp", "https://mcp.stripe.com"),
        entry("io.github.someone/tool", "https://tool.example.dev/mcp", { icon: "https://tool.example.dev/icon.png" }),
        entry("dup", "https://tool.example.dev/mcp"),
      ],
      shown,
    );
    assert.deepEqual(
      extras.map((connector) => connector.id),
      ["stripe", "io.github.someone/tool"],
    );
    assert.equal(extras[0].featured, true);
    assert.equal(extras[1].icon, "https://tool.example.dev/icon.png");
  });
});

describe("helpers", () => {
  it("compares addresses ignoring case and trailing slashes", () => {
    assert.ok(sameAddress("https://API.githubcopilot.com/mcp", "https://api.githubcopilot.com/mcp/"));
    assert.equal(featuredFor("https://mcp.stripe.com/")?.id, "stripe");
    assert.equal(featuredFor("https://elsewhere.dev/mcp"), undefined);
  });

  it("adds the prefix once", () => {
    assert.equal(withPrefix(" abc ", "Bearer "), "Bearer abc");
    assert.equal(withPrefix("bearer abc", "Bearer "), "bearer abc");
    assert.equal(withPrefix("", "Bearer "), "");
    assert.equal(withPrefix("abc"), "abc");
  });

  it("makes a short monogram", () => {
    assert.equal(monogram("Mercado Pago"), "MP");
    assert.equal(monogram("linear"), "Li");
    assert.equal(monogram(""), "?");
  });
});

describe("logoSources", () => {
  it("keeps the catalog icon first and falls back to the publisher's own picture", () => {
    assert.deepEqual(logoSources({ icon: "https://example.com/icon.png", publisher: { kind: "github", label: "someone" }, url: "https://mcp.example.dev/mcp" }), [
      "https://example.com/icon.png",
      "https://github.com/someone.png?size=96",
      "https://mcp.example.dev/favicon.ico",
      "https://example.dev/favicon.ico",
    ]);
  });

  it("tries the publisher domain before the address of the server", () => {
    assert.deepEqual(logoSources({ publisher: { kind: "domain", label: "example.com" }, url: "https://mcp.example.com/mcp" }), [
      "https://example.com/favicon.ico",
      "https://mcp.example.com/favicon.ico",
    ]);
  });

  it("never builds an address from a label that is not a plain name", () => {
    assert.deepEqual(logoSources({ publisher: { kind: "github", label: "../evil" }, url: "not a url" }), []);
    assert.deepEqual(logoSources({ publisher: { kind: "domain", label: "evil.com/x?" }, url: "https://raw.githubusercontent.com/a" }), []);
  });
});
