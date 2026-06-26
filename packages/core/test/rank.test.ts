import { describe, it, expect } from "vitest";
import { scoreHeuristics, computeRanks, buildVisionPrompt, HEURISTICS } from "../src/rank.js";

const good = { width: 800, height: 800, sharpness: 200, brightness: 130, aspectRatio: 1 };

describe("scoreHeuristics", () => {
  it("passes a good portrait", () => {
    expect(scoreHeuristics(good)).toEqual({ rejected: false, reason: null });
  });
  it("rejects low resolution first", () => {
    const v = scoreHeuristics({ ...good, width: 100, height: 100, sharpness: 5 });
    expect(v.rejected).toBe(true);
    expect(v.reason).toMatch(/resolution/i);
  });
  it("rejects blur when resolution is fine", () => {
    const v = scoreHeuristics({ ...good, sharpness: 10 });
    expect(v.reason).toMatch(/blur|sharp/i);
  });
  it("rejects too-dark images", () => {
    expect(scoreHeuristics({ ...good, brightness: 10 }).reason).toMatch(/dark|bright|light/i);
  });
  it("rejects extreme aspect ratios", () => {
    expect(scoreHeuristics({ ...good, width: 2000, height: 400, aspectRatio: 5 }).reason).toMatch(/aspect|crop|shape/i);
  });
});

describe("computeRanks", () => {
  it("ranks ranked photos by descending score, ties by id", () => {
    const ranks = computeRanks([
      { id: 1, stage: "ranked", score: 70 },
      { id: 2, stage: "rejected", score: null },
      { id: 3, stage: "ranked", score: 90 },
      { id: 4, stage: "ranked", score: 70 },
    ]);
    expect(ranks).toEqual([
      { id: 3, rank: 1 },
      { id: 1, rank: 2 },
      { id: 4, rank: 3 },
    ]);
  });
});

describe("buildVisionPrompt", () => {
  it("mentions the rubric dimensions and a 0-100 score", () => {
    const p = buildVisionPrompt("a.jpg");
    expect(p).toMatch(/0.*100/);
    expect(p.toLowerCase()).toContain("lighting");
    expect(p.toLowerCase()).toContain("background");
  });
  it("references the constants object", () => {
    expect(HEURISTICS.minLongEdge).toBe(256);
  });
});
