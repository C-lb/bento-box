import { describe, it, expect } from "vitest";
import { parseRanges, safeFileName, summarizeRanges, planSlices } from "../src/slice-plan.js";

describe("parseRanges", () => {
  it("expands ranges and singles, sorted and deduped", () => {
    expect(parseRanges("1-3, 5, 2")).toEqual([1, 2, 3, 5]);
  });
  it("normalizes reversed ranges", () => {
    expect(parseRanges("5-3")).toEqual([3, 4, 5]);
  });
  it("ignores junk", () => {
    expect(parseRanges("a, , 2-x, 4")).toEqual([4]);
  });
});

describe("safeFileName", () => {
  it("strips unsafe chars and spaces", () => {
    expect(safeFileName("Q&A / Panel!")).toBe("QA-Panel");
  });
  it("falls back when empty", () => {
    expect(safeFileName("***")).toBe("part");
  });
});

describe("summarizeRanges", () => {
  it("collapses consecutive runs", () => {
    expect(summarizeRanges([1, 2, 3, 5, 7, 8])).toBe("1-3, 5, 7-8");
  });
});

describe("planSlices", () => {
  it("plans groups, clamps pages, and dedupes filenames", () => {
    const plan = planSlices(
      [
        { label: "Intro", ranges: "1-3" },
        { label: "Intro", ranges: "4" },
      ],
      5,
    );
    expect(plan.groups.map((g) => ({ f: g.filename, p: g.pages }))).toEqual([
      { f: "Intro.pdf", p: [1, 2, 3] },
      { f: "Intro-2.pdf", p: [4] },
    ]);
    expect(plan.warnings).toContain("Pages not in any group: 5.");
  });

  it("drops out-of-range pages with a warning and skips empty groups", () => {
    const plan = planSlices([{ label: "A", ranges: "9-12" }], 5);
    expect(plan.groups).toEqual([]);
    expect(plan.warnings.some((w) => w.includes("no valid pages"))).toBe(true);
  });

  it("warns on overlap between groups", () => {
    const plan = planSlices(
      [
        { label: "A", ranges: "1-3" },
        { label: "B", ranges: "3-4" },
      ],
      4,
    );
    expect(plan.warnings.some((w) => w.includes("Page 3 is in both"))).toBe(true);
  });
});
