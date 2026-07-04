import { describe, it, expect } from "vitest";
import { nUpGrid } from "./nup.js";

const A4 = { width: 595.28, height: 841.89 };

describe("nUpGrid", () => {
  it("computes a 6-up grid for a 288x216 badge on A4", () => {
    const g = nUpGrid(A4, { width: 288, height: 216 }, 18);
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(3);
    expect(g.placements).toHaveLength(6);
  });
  it("centers the block horizontally", () => {
    const g = nUpGrid(A4, { width: 288, height: 216 }, 18);
    const blockW = 2 * 288 + 18;
    const startX = (595.28 - blockW) / 2;
    expect(g.placements[0].x).toBeCloseTo(startX, 2);
  });
  it("orders top row first (highest y first)", () => {
    const g = nUpGrid(A4, { width: 288, height: 216 }, 18);
    // placement 0 is top-left; its y is above placement 2 (next row)
    expect(g.placements[0].y).toBeGreaterThan(g.placements[2].y);
  });
  it("never returns fewer than one cell", () => {
    const g = nUpGrid({ width: 100, height: 100 }, { width: 999, height: 999 }, 0);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(1);
    expect(g.placements).toHaveLength(1);
  });
  it("computes 5-up for a 396x144 ticket", () => {
    const g = nUpGrid(A4, { width: 396, height: 144 }, 18);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(5);
  });
});
