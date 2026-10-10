import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESSORIES, BODIES, cleanLook, DEFAULT_LOOK } from "@/lib/look";
import { figurePng, figureSvg, isFigureRoute } from "./figure-png";

test("a character renders to a PNG of the asked size", async () => {
  const png = await figurePng(DEFAULT_LOOK, 192);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 192);
  assert.equal(png.readUInt32BE(20), 192);
});

test("every accessory renders on every shape", async () => {
  for (const body of BODIES) {
    for (const acc of ACCESSORIES) {
      const look = cleanLook({ body, color: "#3B93F0", eyes: "happy", acc });
      const svg = figureSvg(look);
      assert.ok(!svg.includes("NaN"), `${body} ${acc}`);
      assert.ok(!svg.includes("url(#ID-"), `${body} ${acc}`);
      if (acc === "none") assert.ok(!svg.includes("-soft"));
      else assert.ok(svg.includes("p-a"), `${body} ${acc}`);
    }
  }
  const png = await figurePng(cleanLook({ ...DEFAULT_LOOK, acc: "crown" }), 96);
  assert.equal(png.readUInt32BE(16), 96);
  assert.notDeepEqual(png, await figurePng(DEFAULT_LOOK, 96));
});

test("unknown look values fall back to a valid character", () => {
  const svg = figureSvg({ body: "<script>", color: "red;}", eyes: "x" } as never);
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.startsWith("<svg"));
});

test("only icon and avatar paths are served as figures", () => {
  assert.equal(isFigureRoute("/icons/icon-192.png"), true);
  assert.equal(isFigureRoute("/api/agents/agt_abc-1/avatar.png"), true);
  assert.equal(isFigureRoute("/api/agents/../avatar.png"), false);
  assert.equal(isFigureRoute("/icons/other.png"), false);
});
