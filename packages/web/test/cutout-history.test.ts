import { describe, it, expect } from "vitest";
import { sortNewestFirst, idsToPrune, newCutoutId, type CutoutHistoryItem } from "@/lib/cutout-history";

function item(id: string, at: number): CutoutHistoryItem {
  return { id, name: `${id}.png`, at, blob: new Blob([id]) };
}

describe("sortNewestFirst", () => {
  it("orders by descending timestamp", () => {
    const out = sortNewestFirst([item("a", 1), item("c", 3), item("b", 2)]);
    expect(out.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
});

describe("idsToPrune", () => {
  it("returns nothing when under the cap", () => {
    expect(idsToPrune([item("a", 1), item("b", 2)], 5)).toEqual([]);
  });
  it("drops the oldest beyond the cap", () => {
    const items = [item("a", 1), item("b", 2), item("c", 3), item("d", 4)];
    expect(idsToPrune(items, 2)).toEqual(["b", "a"]); // keep newest 2 (d, c)
  });
});

describe("newCutoutId", () => {
  it("produces unique-ish prefixed ids", () => {
    const a = newCutoutId();
    const b = newCutoutId();
    expect(a.startsWith("co-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
