import { describe, it, expect } from "vitest";
import { pickCachedSummary } from "../lib/summary-format";

describe("pickCachedSummary", () => {
  it("reads the cached column for a format", () => {
    const row = { summaryLinkedin: "LI", summaryArticle: null };
    expect(pickCachedSummary(row as any, "linkedin")).toBe("LI");
    expect(pickCachedSummary(row as any, "article")).toBeNull();
  });
});
