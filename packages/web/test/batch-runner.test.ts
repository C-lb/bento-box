import { describe, it, expect, vi } from "vitest";
import { runWithConcurrency, matchSheetRows } from "../lib/batch";

describe("runWithConcurrency", () => {
  it("runs all items with a bounded number in flight", async () => {
    let inFlight = 0, maxSeen = 0;
    const order: number[] = [];
    const items = [1, 2, 3, 4, 5];
    await runWithConcurrency(items, 2, async (n) => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      order.push(n); inFlight--;
    });
    expect(maxSeen).toBeLessThanOrEqual(2);
    expect(order.sort()).toEqual(items);
  });

  it("a throwing worker does not stop the rest", async () => {
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      done.push(n);
    });
    expect(done.sort()).toEqual([1, 3]);
  });
});

describe("matchSheetRows", () => {
  it("maps each data row to name/title + a match", () => {
    const out = matchSheetRows({
      header: ["Name", "Title", "Photo"],
      rows: [["Ada", "CTO", "ada.jpg"], ["Nobody", "X", "missing.jpg"]],
      mapping: { name: 0, title: 1, photo: 2 },
      folderFiles: [{ id: "f1", name: "Ada.JPG" }],
    });
    expect(out[0]).toEqual({ index: 0, name: "Ada", title: "CTO", match: { status: "matched", driveFileId: "f1" } });
    expect(out[1].match.status).toBe("unmatched");
  });
});
