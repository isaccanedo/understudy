import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESSORIES, BODIES, cleanLook, COLORS, DEFAULT_LOOK, EYES, randomLook } from "./look";

test("cleanLook keeps known values and replaces unknown ones", () => {
  assert.deepEqual(cleanLook({ body: "hexagon", color: "#000000", eyes: "nope" }), { ...DEFAULT_LOOK, body: "hexagon" });
});

test("cleanLook falls back to the default look", () => {
  assert.deepEqual(cleanLook(null), DEFAULT_LOOK);
});

test("cleanLook carries looks saved before the redesign over to the new parts", () => {
  assert.deepEqual(cleanLook({ body: "pill", color: "#7FB2FF", eyes: "dot", acc: "cap", accColor: "#2F3A56" } as never), {
    body: "capsule",
    color: "#3B93F0",
    eyes: "attentive",
    acc: "cap",
    accColor: "#5B6472",
  });
  assert.equal(cleanLook({ acc: "beret" } as never).acc, "beanie");
  assert.equal(cleanLook({ acc: "ears" } as never).acc, "none");
});

test("a look saved without an accessory wears none", () => {
  const look = cleanLook({ body: "circle", color: "#3B93F0", eyes: "happy" });
  assert.equal(look.acc, "none");
  assert.ok(COLORS.includes(look.accColor));
});

test("cleanLook keeps a known accessory and drops an unknown one or a bad color", () => {
  assert.deepEqual(cleanLook({ ...DEFAULT_LOOK, acc: "crown", accColor: "#f5c33b" }), { ...DEFAULT_LOOK, acc: "crown", accColor: "#F5C33B" });
  const odd = cleanLook({ ...DEFAULT_LOOK, acc: "<script>", accColor: "red;}" });
  assert.equal(odd.acc, "none");
  assert.ok(COLORS.includes(odd.accColor));
});

test("an accessory without a saved color gets one that stands out from the body", () => {
  const look = cleanLook({ body: "circle", color: "#3ECF8E", eyes: "happy", acc: "sprout" });
  assert.notEqual(look.accColor, look.color);
});

test("randomLook only picks known parts", () => {
  for (let i = 0; i < 50; i++) {
    const look = randomLook(Math.random());
    assert.ok(BODIES.includes(look.body));
    assert.ok(EYES.includes(look.eyes));
    assert.ok(ACCESSORIES.includes(look.acc));
    assert.deepEqual(cleanLook(look), look);
  }
});
