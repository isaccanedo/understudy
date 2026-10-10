import assert from "node:assert/strict";
import { test } from "node:test";

process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.UNDERSTUDY_PUBLIC_URL = "https://panel.example.com";

test("a Slack link token names the Slack account it was made for, only until it expires", async () => {
  const { readSlackLinkToken, slackLinkToken, SLACK_LINK_TTL_MS } = await import("./slack-link");
  const now = Date.now();
  const token = slackLinkToken("U0MEMBER01", now);
  assert.equal(readSlackLinkToken(token, now + 1000), "U0MEMBER01");
  assert.equal(readSlackLinkToken(token, now + SLACK_LINK_TTL_MS + 1), null);
});

test("a tampered or foreign token is refused", async () => {
  const { readSlackLinkToken, slackLinkToken } = await import("./slack-link");
  const { seal } = await import("@/lib/secret-box");
  const token = slackLinkToken("U0MEMBER01");
  const [iv, tag, data] = token.split(".");
  const flipped = `${iv}.${tag}.${data.slice(0, -2)}${data.endsWith("AA") ? "BB" : "AA"}`;
  assert.equal(readSlackLinkToken(flipped), null);
  assert.equal(readSlackLinkToken("not-a-token"), null);
  assert.equal(readSlackLinkToken(seal(JSON.stringify({ slackUserId: "U0MEMBER01", exp: Date.now() + 60_000 }))), null);
  assert.equal(readSlackLinkToken(seal(JSON.stringify({ purpose: "slack-link", slackUserId: "#general", exp: Date.now() + 60_000 }))), null);
});

test("the link opens the Slack section of the person's settings", async () => {
  const { readSlackLinkToken, slackLinkUrl } = await import("./slack-link");
  const url = new URL(slackLinkUrl("U0MEMBER01"));
  assert.equal(url.origin, "https://panel.example.com");
  assert.equal(url.pathname, "/settings");
  assert.equal(url.hash, "#slack");
  assert.equal(readSlackLinkToken(url.searchParams.get("slack") ?? ""), "U0MEMBER01");
});
