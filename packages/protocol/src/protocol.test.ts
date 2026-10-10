import assert from "node:assert/strict";
import { test } from "node:test";
import {
  looksIrreversible,
  normalizeRecipe,
  parseComputerToServer,
  parseHostToServer,
  parseServerToComputer,
  parseServerToHost,
  RECIPE_LIMITS,
  SENSITIVE_LABEL,
} from "./index.ts";

test("valid messages parse from objects, strings and bytes", () => {
  assert.deepEqual(parseServerToComputer({ type: "viewers", count: 2 }), { ok: true, message: { type: "viewers", count: 2 } });
  assert.equal(parseServerToComputer('{"type":"ping","at":1}').ok, true);
  assert.equal(parseServerToComputer('{"type":"profile","name":"Pip","ownerName":"Ana","look":{"body":"cloud","color":"#3ECF8E","eyes":"happy","acc":"none"}}').ok, true);
  assert.equal(parseServerToComputer(JSON.stringify({ type: "profile", name: "x".repeat(101), look: { body: "cloud", color: "#3ECF8E", eyes: "happy" } })).ok, false);
  assert.equal(parseServerToComputer(new TextEncoder().encode('{"type":"stop"}')).ok, true);
  assert.equal(parseComputerToServer({ type: "hello", agentId: "a", version: "1", brains: [{ brain: "claude", loggedIn: true }] }).ok, true);
  assert.equal(parseServerToHost({ type: "computer_ensure", spec: { agentId: "a", token: "t", image: "", serverUrl: "http://p" } }).ok, true);
  assert.equal(parseHostToServer({ type: "computer_status", agentId: "a", status: "running" }).ok, true);
});

test("invalid messages are refused with a reason", () => {
  assert.deepEqual(parseServerToComputer("not json"), { ok: false, error: "not JSON" });
  const unknown = parseServerToComputer({ type: "format_disk" });
  assert.equal(unknown.ok, false);
  const wrong = parseServerToComputer({ type: "viewers", count: -1 });
  assert.equal(wrong.ok, false);
  assert.match(wrong.ok ? "" : wrong.error, /count/);
  assert.equal(parseComputerToServer({ type: "state", state: "dancing" }).ok, false);
  assert.equal(parseServerToHost({ type: "computer_ensure", spec: { agentId: "", token: "t", image: "", serverUrl: "x" } }).ok, false);
});

test("unknown extra fields are dropped, not trusted", () => {
  const parsed = parseServerToComputer({ type: "stop", extra: "x" });
  assert.deepEqual(parsed, { ok: true, message: { type: "stop" } });
});

test("one normalizer: irreversible steps ask in English and Portuguese, lengths are capped", () => {
  const recipe = normalizeRecipe({
    title: "x".repeat(500),
    steps: [
      { id: "s1", text: "Open the report", mode: "auto" },
      { id: "s1", text: "Send the invoice", mode: "auto" },
      { text: "Enviar o boleto por e-mail", mode: "auto" },
      { text: "   " },
      { text: "y".repeat(5000), detail: "z".repeat(5000) },
    ],
    questions: [{ text: "Which bank?", options: ["A", "B", ""] }, { text: "" }],
    askFirstRuns: 999,
  });
  assert.equal(recipe.title.length, RECIPE_LIMITS.title);
  assert.deepEqual(recipe.steps.map((step) => step.mode), ["auto", "ask", "ask", "auto"]);
  assert.deepEqual(recipe.steps.map((step) => step.id), ["s1", "s2", "s3", "s4"]);
  assert.equal(recipe.steps[3].text.length, RECIPE_LIMITS.stepText);
  assert.equal(recipe.steps[3].detail?.length, RECIPE_LIMITS.stepDetail);
  assert.deepEqual(recipe.questions, [{ id: "q1", text: "Which bank?", options: ["A", "B"] }]);
  assert.equal(recipe.askFirstRuns, RECIPE_LIMITS.askFirstRuns);
  assert.equal(normalizeRecipe({ steps: [{ text: "a" }] }).askFirstRuns, 3);
  assert.throws(() => normalizeRecipe({ steps: [] }, { requireSteps: true }));
  assert.throws(() => normalizeRecipe(null));
});

test("locale patterns cover English and Portuguese", () => {
  assert.equal(looksIrreversible("Pay the supplier"), true);
  assert.equal(looksIrreversible("Pagar o fornecedor"), true);
  assert.equal(looksIrreversible("Sign in with the account"), false);
  assert.equal(looksIrreversible("Abrir o relatório"), false);
  assert.equal(SENSITIVE_LABEL.test("Card number"), true);
  assert.equal(SENSITIVE_LABEL.test("Número do cartão"), true);
  assert.equal(SENSITIVE_LABEL.test("Student name"), false);
});

test("owner rules: amounts, email domains and blocked sites are caught, and rules parse", async () => {
  const { findViolation, parseAmounts, argsSubject, rulesBriefing, normalizeSite, OwnerRuleSchema } = await import("./index.ts");
  assert.deepEqual(parseAmounts("$1,240.00"), [1240]);
  assert.deepEqual(parseAmounts("R$ 1.240,50"), [1240.5]);
  assert.deepEqual(parseAmounts("1.240"), [1240]);
  assert.deepEqual(parseAmounts("12,5"), [12.5]);
  assert.deepEqual(parseAmounts("1 000 000"), [1000000]);
  assert.deepEqual(parseAmounts("1,000,000.99"), [1000000.99]);
  assert.deepEqual(parseAmounts("due 2026-10-10, 10/10/2026 at 14:30"), []);
  const rules = [
    { id: "r1", kind: "max_amount" as const, amount: 1000, currency: "USD" },
    { id: "r2", kind: "allowed_email_domains" as const, domains: ["@northwind.com", "acme.io"] },
    { id: "r3", kind: "blocked_site" as const, site: "https://www.Gamble.example/path" },
    { id: "r4", kind: "custom" as const, text: "Never work on weekends." },
  ];
  for (const rule of rules) assert.ok(OwnerRuleSchema.safeParse(rule).success);
  assert.equal(normalizeSite(rules[2].site), "gamble.example");
  assert.equal(findViolation(rules, { amounts: ["999.99"] }), null);
  assert.equal(findViolation(rules, { amounts: ["$1,240.00"] })?.rule.id, "r1");
  assert.equal(findViolation(rules, { texts: ["send to ana@northwind.com and bob@sales.acme.io"] }), null);
  assert.equal(findViolation(rules, { texts: ["cc eve@northwind.com.evil.net"] })?.rule.id, "r2");
  assert.equal(findViolation(rules, { urls: ["https://shop.gamble.example/buy"] })?.rule.id, "r3");
  assert.equal(findViolation(rules, { urls: ["gamble.example"] })?.rule.id, "r3");
  assert.equal(findViolation(rules, { urls: ["https://notgamble.example/"] }), null);
  const subject = argsSubject({ to: ["x@other.org"], payment: { amount: 5000, memo: "invoice 2041" }, link: "https://www.gamble.example" });
  assert.deepEqual(subject.amounts, ["5000"]);
  assert.equal(findViolation(rules, subject)?.rule.id, "r1");
  assert.equal(findViolation([rules[1]], subject)?.rule.id, "r2");
  assert.equal(findViolation([rules[2]], subject)?.rule.id, "r3");
  const brief = rulesBriefing(rules);
  assert.match(brief, /above 1,000 USD/);
  assert.match(brief, /outside northwind.com, acme.io/);
  assert.match(brief, /Never open gamble.example/);
  assert.match(brief, /Never work on weekends/);
  assert.equal(rulesBriefing([]), "");
});
