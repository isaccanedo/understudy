import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeSlack } from "./slack";

test("agent text cannot become a Slack link or mention", () => {
  assert.equal(escapeSlack("<https://evil.example|Open the panel>"), "&lt;https://evil.example|Open the panel&gt;");
  assert.equal(escapeSlack("a & b <!channel>"), "a &amp; b &lt;!channel&gt;");
});
