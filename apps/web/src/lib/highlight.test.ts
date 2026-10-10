import assert from "node:assert/strict";
import { test } from "node:test";
import { highlight } from "./highlight";

test("code is split into tokens without losing a character", () => {
  const code = 'const total = 42; // sum\nreturn "ok";';
  const tokens = highlight(code, "javascript");
  assert.equal(tokens.map((t) => t.text).join(""), code);
  assert.deepEqual(tokens.filter((t) => t.kind !== "plain").map((t) => [t.kind, t.text]), [["keyword", "const"], ["number", "42"], ["comment", "// sum"], ["keyword", "return"], ["string", '"ok"']]);
});

test("python comments, json keys and html stay text, never markup", () => {
  assert.deepEqual(highlight("x = 1 # note", "python").at(-1), { kind: "comment", text: "# note" });
  assert.deepEqual(highlight('{"name": "a"}', "json").filter((t) => t.kind !== "plain").map((t) => t.kind), ["key", "string"]);
  const html = '<script>alert("x")</script>';
  assert.equal(highlight(html, "html").map((t) => t.text).join(""), html);
  assert.deepEqual(highlight("plain words", "text"), [{ kind: "plain", text: "plain words" }]);
});
