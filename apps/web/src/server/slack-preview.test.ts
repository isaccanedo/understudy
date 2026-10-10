import assert from "node:assert/strict";
import { test } from "node:test";
import { clipPreview, slackPreview } from "./slack-preview";

test("an approval preview shows links and bold the way the message will look", () => {
  assert.equal(
    slackPreview("• <https://example.com/record/123|School name> — *+R$ 10,00*"),
    "• <https://example.com/record/123|School name> (example.com) — *+R$ 10,00*",
  );
  assert.equal(slackPreview("see <https://example.com/a?b=1>"), "see <https://example.com/a?b=1>");
  assert.equal(slackPreview("<https://example.com|example.com/home>"), "<https://example.com|example.com/home>");
});

test("an approval preview never pings anyone or hides a link behind a label", () => {
  assert.equal(slackPreview("hi <!channel> and <!here|here> <@U0PERSON1>"), "hi &lt;!channel&gt; and &lt;!here|here&gt; &lt;@U0PERSON1&gt;");
  assert.equal(slackPreview("<javascript:alert(1)|click>"), "&lt;javascript:alert(1)|click&gt;");
  assert.equal(slackPreview("<https://evil.example|Open the panel>"), "<https://evil.example|Open the panel> (evil.example)");
  assert.equal(slackPreview("a & b \u00000\u0000 <https://example.com|x & y>"), "a &amp; b 0 <https://example.com|x &amp; y> (example.com)");
});

test("clipping a long preview never leaves half a link", () => {
  const text = `${"x".repeat(20)}<https://example.com/long|label>`;
  assert.deepEqual(clipPreview(text, 30), { text: "x".repeat(20), clipped: true });
  assert.deepEqual(clipPreview("short", 30), { text: "short", clipped: false });
});
