import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeIndex, keyIntent, moveIndex, placePopup, selectedIndex, typeahead, type SelectOption } from "./select-logic";

const options: SelectOption[] = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana", disabled: true },
  { value: "c", label: "Blueberry" },
  { value: "d", label: "Cherry" },
  { value: "e", label: "Black currant" },
];

describe("moveIndex", () => {
  it("skips disabled options", () => {
    assert.equal(moveIndex(options, 0, 1), 2);
    assert.equal(moveIndex(options, 2, -1), 0);
  });

  it("stops at the ends instead of wrapping", () => {
    assert.equal(moveIndex(options, 4, 1), 4);
    assert.equal(moveIndex(options, 0, -1), 0);
  });

  it("jumps a page and stays inside the list", () => {
    assert.equal(moveIndex(options, 0, 10), 4);
    assert.equal(moveIndex(options, 4, -10), 0);
  });

  it("starts from the edge when nothing is active", () => {
    assert.equal(moveIndex(options, -1, 1), 0);
    assert.equal(moveIndex(options, -1, -1), 4);
  });
});

describe("edgeIndex and selectedIndex", () => {
  it("finds the first and last enabled option", () => {
    assert.equal(edgeIndex([{ value: "x", label: "X", disabled: true }, ...options], "first"), 1);
    assert.equal(edgeIndex(options, "last"), 4);
  });

  it("falls back to the first option when the value is unknown or disabled", () => {
    assert.equal(selectedIndex(options, "d"), 3);
    assert.equal(selectedIndex(options, "b"), 0);
    assert.equal(selectedIndex(options, "zzz"), 0);
  });
});

describe("typeahead", () => {
  it("jumps to the next option starting with the typed letter", () => {
    assert.equal(typeahead(options, "c", 0), 3);
  });

  it("cycles through options with the same first letter when the letter repeats", () => {
    assert.equal(typeahead(options, "b", 0), 2);
    assert.equal(typeahead(options, "bb", 2), 4);
    assert.equal(typeahead(options, "bbb", 4), 2);
  });

  it("matches a longer prefix from the current option and ignores disabled ones", () => {
    assert.equal(typeahead(options, "bla", 0), 4);
    assert.equal(typeahead(options, "ban", 0), 0);
  });

  it("is case insensitive", () => {
    assert.equal(typeahead(options, "CH", 0), 3);
  });
});

describe("keyIntent", () => {
  it("opens on arrows, Enter and Space when closed", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) assert.deepEqual(keyIntent({ key }, false, false), { type: "open", to: "selected" });
    assert.deepEqual(keyIntent({ key: "End" }, false, false), { type: "open", to: "last" });
  });

  it("moves, commits and closes when open", () => {
    assert.deepEqual(keyIntent({ key: "ArrowDown" }, true, false), { type: "move", by: 1 });
    assert.deepEqual(keyIntent({ key: "Enter" }, true, false), { type: "commit", thenClose: true });
    assert.deepEqual(keyIntent({ key: "Escape" }, true, false), { type: "close" });
    assert.deepEqual(keyIntent({ key: "Tab" }, true, false), { type: "commit", thenClose: true, keepDefault: true });
  });

  it("treats Space as part of the search while typing", () => {
    assert.deepEqual(keyIntent({ key: " " }, true, true), { type: "type", char: " " });
  });

  it("ignores shortcuts with modifier keys", () => {
    assert.equal(keyIntent({ key: "a", metaKey: true }, true, false), null);
  });
});

describe("placePopup", () => {
  const viewport = { width: 1280, height: 800 };

  it("opens below the field and matches its width", () => {
    const placed = placePopup({ trigger: { top: 100, bottom: 140, left: 300, width: 320 }, viewport, listHeight: 200 });
    assert.deepEqual(placed, { side: "below", top: 146, left: 300, width: 320, maxHeight: 200 });
  });

  it("flips above when there is no room below", () => {
    const placed = placePopup({ trigger: { top: 700, bottom: 740, left: 300, width: 320 }, viewport, listHeight: 200 });
    assert.equal(placed.side, "above");
    assert.equal(placed.top, 700 - 6 - 200);
  });

  it("stays below and scrolls when below still has more room than above", () => {
    const placed = placePopup({ trigger: { top: 250, bottom: 290, left: 0, width: 320 }, viewport: { width: 1280, height: 600 }, listHeight: 900 });
    assert.equal(placed.side, "below");
    assert.equal(placed.maxHeight, 600 - 290 - 6 - 8);
  });

  it("stays inside a 390px phone screen", () => {
    const placed = placePopup({ trigger: { top: 100, bottom: 144, left: 250, width: 120 }, viewport: { width: 390, height: 844 }, listHeight: 160 });
    assert.equal(placed.width, 200);
    assert.equal(placed.left, 390 - 8 - 200);
  });
});
