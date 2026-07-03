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
  it("mentions a 0-100 score and includes the given context", () => {
    const p = buildVisionPrompt("a.jpg", "consider the lighting and background carefully");
    expect(p).toMatch(/0.*100/);
    expect(p.toLowerCase()).toContain("lighting");
    expect(p.toLowerCase()).toContain("background");
  });
  it("references the constants object", () => {
    expect(HEURISTICS.minLongEdge).toBe(256);
  });
});

describe("buildVisionPrompt (context-driven)", () => {
  it("embeds the photo name and the given context", () => {
    const p = buildVisionPrompt("beach.jpg", "MY_CONTEXT_MARKER");
    expect(p).toContain("beach.jpg");
    expect(p).toContain("MY_CONTEXT_MARKER");
    expect(p).toContain("0 to 100");
  });
});

describe("scoreHeuristics platform leniency", () => {
  const dark = { width: 1200, height: 1200, sharpness: 40, brightness: 20, aspectRatio: 1 };
  it("rejects a dark, soft photo under the strict (linkedin) profile", () => {
    expect(scoreHeuristics(dark, "linkedin").rejected).toBe(true);
    // default arg is also strict
    expect(scoreHeuristics(dark).rejected).toBe(true);
  });
  it("accepts the same photo under the instagram lenient profile", () => {
    expect(scoreHeuristics(dark, "instagram").rejected).toBe(false);
  });
});
