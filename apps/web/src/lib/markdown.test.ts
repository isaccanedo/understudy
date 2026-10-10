import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

test("bold, italics and inline code become nodes instead of raw markers", () => {
  assert.deepEqual(parseInline("a **b** *c* `d`"), [
    { kind: "text", value: "a " },
    { kind: "strong", children: [{ kind: "text", value: "b" }] },
    { kind: "text", value: " " },
    { kind: "em", children: [{ kind: "text", value: "c" }] },
    { kind: "text", value: " " },
    { kind: "code", value: "d" },
  ]);
});

test("markers that do not close stay as text", () => {
  assert.deepEqual(parseInline("2 * 3 and **open"), [{ kind: "text", value: "2 * 3 and **open" }]);
});

test("underscores inside words are not italics", () => {
  assert.deepEqual(parseInline("snake_case_name"), [{ kind: "text", value: "snake_case_name" }]);
});

test("html is kept as plain text for React to escape", () => {
  assert.deepEqual(parseInline("<img src=x onerror=alert(1)>"), [{ kind: "text", value: "<img src=x onerror=alert(1)>" }]);
});

test("links keep only safe protocols", () => {
  assert.deepEqual(parseInline("[docs](https://example.com/a)"), [
    { kind: "link", href: "https://example.com/a", children: [{ kind: "text", value: "docs" }] },
  ]);
  assert.equal(parseInline("[click](javascript:alert(1))").some((n) => n.kind === "link"), false);
  assert.equal(safeHref("data:text/html,hi"), null);
  assert.equal(safeHref("mailto:a@example.com"), "mailto:a@example.com");
});

test("bare urls become links without trailing punctuation", () => {
  const nodes = parseInline("see https://example.com/x.");
  assert.deepEqual(nodes[1], { kind: "link", href: "https://example.com/x", children: [{ kind: "text", value: "https://example.com/x" }] });
  assert.deepEqual(nodes[2], { kind: "text", value: "." });
});

test("bullets and numbered lines become lists", () => {
  const blocks = parseMarkdown("Done:\n- one\n- two\n  - nested\n\n1. first\n2. second");
  assert.equal(blocks[0].kind, "paragraph");
  assert.deepEqual(blocks[1], {
    kind: "list",
    ordered: false,
    start: 1,
    items: [
      { depth: 0, children: [{ kind: "text", value: "one" }] },
      { depth: 0, children: [{ kind: "text", value: "two" }] },
      { depth: 1, children: [{ kind: "text", value: "nested" }] },
    ],
  });
  assert.equal(blocks[2].kind === "list" && blocks[2].ordered, true);
});

test("fenced code keeps its content verbatim and tracks an unclosed fence while streaming", () => {
  assert.deepEqual(parseMarkdown("```js\nconst a = **1**;\n```"), [{ kind: "code", lang: "js", value: "const a = **1**;", open: false }]);
  assert.deepEqual(parseMarkdown("```\nhalf"), [{ kind: "code", lang: "", value: "half", open: true }]);
});

test("single newlines inside a paragraph become breaks", () => {
  assert.deepEqual(parseMarkdown("a\nb"), [{ kind: "paragraph", children: [{ kind: "text", value: "a" }, { kind: "break" }, { kind: "text", value: "b" }] }]);
});

test("headings, quotes and rules are recognized", () => {
  const kinds = parseMarkdown("## Title\n> quoted\n\n---\ntext").map((b) => b.kind);
  assert.deepEqual(kinds, ["heading", "quote", "rule", "paragraph"]);
});
