import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactSearch, formatLabel, nextZoom, readArtifactAddress, ZOOM_STEPS } from "./artifact-ui";

test("zoom moves one step at a time and stops at both ends", () => {
  assert.equal(nextZoom(1, 1), 1.1);
  assert.equal(nextZoom(1, -1), 0.9);
  assert.equal(nextZoom(ZOOM_STEPS[0], -1), ZOOM_STEPS[0]);
  assert.equal(nextZoom(3, 1), 3);
  assert.equal(nextZoom(1.05, 1), 1.1);
});

test("pages artifacts are named after their format", () => {
  assert.equal(formatLabel("pages", "deck.pptx"), "Slides");
  assert.equal(formatLabel("pages", "contract.pdf"), "PDF");
  assert.equal(formatLabel("pages", "sheet.xlsx"), "Spreadsheet");
  assert.equal(formatLabel("html", "app.html"), "Interactive");
  assert.equal(formatLabel("markdown", "brief.md"), "Document");
});

test("the address only accepts artifact ids and positive versions", () => {
  assert.deepEqual(readArtifactAddress(new URLSearchParams("tab=artifacts&artifact=art_abc123XYZ&v=2")), { artifactId: "art_abc123XYZ", version: 2 });
  assert.deepEqual(readArtifactAddress(new URLSearchParams("artifact=art_abc123XYZ&v=0")), { artifactId: "art_abc123XYZ", version: null });
  assert.equal(readArtifactAddress(new URLSearchParams("artifact=javascript:alert(1)")), null);
  assert.equal(readArtifactAddress(new URLSearchParams("")), null);
});

test("opening an artifact keeps other params and switches to the artifacts tab", () => {
  assert.equal(artifactSearch("tab=files&x=1", { artifactId: "art_abc123XYZ", version: 3 }), "?tab=artifacts&x=1&artifact=art_abc123XYZ&v=3");
  assert.equal(artifactSearch("tab=artifacts&artifact=art_abc123XYZ&v=3", null), "?tab=artifacts");
  assert.equal(artifactSearch("", { artifactId: "art_abc123XYZ", version: null }), "?tab=artifacts&artifact=art_abc123XYZ");
});
