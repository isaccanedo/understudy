import assert from "node:assert/strict";
import { test } from "node:test";
import { pickAgent, slackManifest, slackManifestUrl, slackSignature, slashCommand, stripMentions, verifySlackSignature } from "./slack-app";

test("the manifest points every Slack callback at the panel and asks only the needed scopes", () => {
  const manifest = slackManifest({ productName: "Understudy", publicUrl: "https://bot.example.com/", description: "Agents" });
  assert.equal(manifest.settings.event_subscriptions.request_url, "https://bot.example.com/api/slack/events");
  assert.equal(manifest.settings.interactivity.request_url, "https://bot.example.com/api/slack/interactivity");
  assert.equal(manifest.features.slash_commands[0].url, "https://bot.example.com/api/slack/commands");
  assert.ok(manifest.oauth_config.scopes.bot.includes("chat:write.customize"));
  assert.ok(slackManifestUrl(manifest).startsWith("https://api.slack.com/apps?new_app=1&manifest_json=%7B"));
  assert.equal(slashCommand("Ajudante da Estação"), "/ajudante-da-estacao");
});

test("only fresh requests signed with the signing secret are accepted", () => {
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  const body = "token=x&text=hi";
  const signature = slackSignature("secret", ts, body);
  assert.equal(verifySlackSignature({ secret: "secret", timestamp: ts, signature, body, now }), true);
  assert.equal(verifySlackSignature({ secret: "other", timestamp: ts, signature, body, now }), false);
  assert.equal(verifySlackSignature({ secret: "secret", timestamp: ts, signature, body: `${body}&x=1`, now }), false);
  assert.equal(verifySlackSignature({ secret: "secret", timestamp: ts, signature, body, now: now + 301_000 }), false);
  assert.equal(verifySlackSignature({ secret: "secret", timestamp: undefined, signature, body, now }), false);
  assert.equal(verifySlackSignature({ secret: "", timestamp: ts, signature: slackSignature("", ts, body), body, now }), false);
});

test("a message goes to the agent named at its start, or to the only agent", () => {
  const agents = [
    { id: "a", name: "Ana" },
    { id: "b", name: "Ana Paula" },
    { id: "c", name: "Bruno" },
  ];
  assert.deepEqual(pickAgent("Bruno, send the report", agents), { agent: agents[2], text: "send the report" });
  assert.deepEqual(pickAgent("ana paula: check invoices", agents), { agent: agents[1], text: "check invoices" });
  assert.deepEqual(pickAgent("Ana pay it", agents), { agent: agents[0], text: "pay it" });
  assert.deepEqual(pickAgent("Anabel, hi", agents), { agent: null, reason: "ambiguous" });
  assert.deepEqual(pickAgent("do it", [agents[2]]), { agent: agents[2], text: "do it" });
  assert.deepEqual(pickAgent("do it", []), { agent: null, reason: "none" });
  assert.equal(stripMentions("<@U123ABC> Bruno, hi <@U9|x>"), "Bruno, hi");
});
