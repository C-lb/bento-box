import { describe, it, expect } from "vitest";
import {
  sortNewestFirst,
  idsToPrune,
  idsForTool,
  exceedsSizeLimit,
  newBlobHistoryId,
  type BlobHistoryItem,
} from "@/lib/blob-history";

function item(id: string, tool: string, at: number): BlobHistoryItem {
  return { id, tool, filename: `${id}.pdf`, at, blob: new Blob([id]) };
}

describe("sortNewestFirst", () => {
  it("orders by descending timestamp", () => {
    const out = sortNewestFirst([item("a", "badge", 1), item("c", "badge", 3), item("b", "badge", 2)]);
    expect(out.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
});

describe("idsToPrune", () => {
  it("returns nothing when the tool is under the cap", () => {
    expect(idsToPrune([item("a", "badge", 1), item("b", "badge", 2)], "badge", 6)).toEqual([]);
  });

  it("drops the tool's oldest beyond the cap of 6", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`b${i}`, "badge", i + 1));
    // keep newest 6 (b7..b2), drop b1 then b0 (oldest last in newest-first order)
    expect(idsToPrune(items, "badge")).toEqual(["b1", "b0"]);
  });

  it("never prunes another tool's items", () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => item(`b${i}`, "badge", i + 1)),
      ...Array.from({ length: 8 }, (_, i) => item(`t${i}`, "ticket", i + 1)),
    ];
    const pruned = idsToPrune(items, "badge");
    expect(pruned).toEqual(["b1", "b0"]);
    expect(pruned.some((id) => id.startsWith("t"))).toBe(false);
  });

  it("scopes independently per tool", () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) => item(`b${i}`, "badge", i + 1)),
      item("t0", "ticket", 1),
    ];
    expect(idsToPrune(items, "badge")).toEqual(["b0"]);
    expect(idsToPrune(items, "ticket")).toEqual([]);
  });
});

describe("idsForTool", () => {
  it("selects only the given tool's ids (clear all scope)", () => {
    const items = [item("b0", "badge", 1), item("t0", "ticket", 2), item("b1", "badge", 3)];
    expect(idsForTool(items, "badge")).toEqual(["b0", "b1"]);
    expect(idsForTool(items, "certificate")).toEqual([]);
  });
});

describe("exceedsSizeLimit", () => {
  it("allows blobs at or under 50MB", () => {
    expect(exceedsSizeLimit(50 * 1024 * 1024)).toBe(false);
    expect(exceedsSizeLimit(1024)).toBe(false);
  });

  it("rejects blobs over 50MB", () => {
    expect(exceedsSizeLimit(50 * 1024 * 1024 + 1)).toBe(true);
  });

  it("honours a custom limit", () => {
    expect(exceedsSizeLimit(11, 10)).toBe(true);
    expect(exceedsSizeLimit(10, 10)).toBe(false);
  });
});

describe("newBlobHistoryId", () => {
  it("produces unique-ish prefixed ids", () => {
    const a = newBlobHistoryId();
    const b = newBlobHistoryId();
    expect(a.startsWith("mh-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
