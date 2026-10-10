import assert from "node:assert/strict";
import { test } from "node:test";
import { fileKind, latestDeliveries, latestOutputs } from "./outputs";

test("the card shows the newest deliveries first, three at most", () => {
  const files = [
    { path: "a.xlsx", size: 1, updatedAt: 10 },
    { path: "b.docx", size: 1, updatedAt: 40 },
    { path: "c.pdf", size: 1, updatedAt: 30 },
    { path: "d.png", size: 1, updatedAt: 20 },
  ];
  assert.deepEqual(
    latestOutputs(files).map((file) => file.path),
    ["b.docx", "c.pdf", "d.png"],
  );
  assert.equal(files[0].path, "a.xlsx");
});

test("each delivery gets a short label by its extension", () => {
  assert.deepEqual(fileKind("reports/open-invoices.XLSX"), { label: "XLS", tone: "sheet" });
  assert.deepEqual(fileKind("notes.md"), { label: "DOC", tone: "doc" });
  assert.deepEqual(fileKind("deck.pptx"), { label: "PPT", tone: "deck" });
  assert.deepEqual(fileKind("archive.zip"), { label: "ZIP", tone: "other" });
  assert.deepEqual(fileKind("README"), { label: "FILE", tone: "other" });
  assert.deepEqual(fileKind("v1.2/notes"), { label: "FILE", tone: "other" });
});

test("artifacts and outbox files share the list, newest first, and a published file is not listed twice", () => {
  const artifacts = [
    { id: "art_deck000001", title: "Renewal fixes, week 41", name: "week-41.pptx", latestVersion: 2, updatedAt: "2026-10-09T10:00:00.000Z" },
    { id: "art_calc000001", title: "Price check", name: "price-check.html", latestVersion: 1, updatedAt: "2026-10-08T10:00:00.000Z" },
  ];
  const files = [
    { path: "week-41.pptx", size: 1, updatedAt: Date.parse("2026-10-09T10:00:00.000Z") },
    { path: "invoices.xlsx", size: 1, updatedAt: Date.parse("2026-10-09T09:00:00.000Z") },
    { path: "old.csv", size: 1, updatedAt: Date.parse("2026-10-01T09:00:00.000Z") },
  ];
  assert.deepEqual(
    latestDeliveries(artifacts, files).map((item) => item.key),
    ["artifact:art_deck000001", "file:invoices.xlsx", "artifact:art_calc000001"],
  );
  assert.deepEqual(latestDeliveries([], files, 2).map((item) => item.key), ["file:week-41.pptx", "file:invoices.xlsx"]);
  assert.deepEqual(latestDeliveries(artifacts, []).map((item) => item.kind), ["artifact", "artifact"]);
  assert.deepEqual(fileKind("price-check.html"), { label: "WEB", tone: "deck" });
});
