import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanRules, MAX_RULES } from "./rules";

test("rules from the panel are normalized, given ids and refused when malformed", () => {
  const rules = cleanRules([
    { kind: "max_amount", amount: "1500" },
    { kind: "allowed_email_domains", domains: ["@Northwind.com", "acme.io", "not a domain"] },
    { kind: "blocked_site", site: "https://www.Gamble.example/promo" },
    { kind: "custom", text: "  Never  cancel orders  " },
  ]);
  assert.ok(rules);
  assert.equal(rules.length, 4);
  assert.ok(rules.every((rule) => /^rule_/.test(rule.id)));
  assert.deepEqual(rules.map(({ id: _id, ...rest }) => rest), [
    { kind: "max_amount", amount: 1500 },
    { kind: "allowed_email_domains", domains: ["northwind.com", "acme.io"] },
    { kind: "blocked_site", site: "gamble.example" },
    { kind: "custom", text: "Never cancel orders" },
  ]);
  const kept = cleanRules([{ id: rules[0].id, kind: "max_amount", amount: 10 }]);
  assert.equal(kept?.[0].id, rules[0].id);
  assert.equal(cleanRules([{ kind: "max_amount", amount: -5 }]), null);
  assert.equal(cleanRules([{ kind: "allowed_email_domains", domains: ["nope"] }]), null);
  assert.equal(cleanRules([{ kind: "blocked_site", site: "localhost" }]), null);
  assert.equal(cleanRules([{ kind: "shell", text: "x" }]), null);
  assert.equal(cleanRules("x"), null);
  assert.equal(cleanRules(Array.from({ length: MAX_RULES + 1 }, () => ({ kind: "custom", text: "x" }))), null);
  assert.deepEqual(cleanRules([]), []);
});
