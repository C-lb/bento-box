import { describe, it, expect } from "vitest";
import { parsePageRanges } from "../src/pdf.js";

describe("parsePageRanges", () => {
  it("parses comma-separated ranges and singles into 0-based lists", () => {
    expect(parsePageRanges("1-3, 5, 8-10", 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
  });
  it("tolerates whitespace and trailing commas", () => {
    expect(parsePageRanges(" 2 , 4 - 5 , ", 5)).toEqual([[1], [3, 4]]);
  });
  it("throws on a page beyond the document", () => {
    expect(() => parsePageRanges("1-99", 3)).toThrow(/only 3 pages/i);
  });
  it("throws on a descending range", () => {
    expect(() => parsePageRanges("5-2", 10)).toThrow(/invalid range/i);
  });
  it("throws on non-numeric input", () => {
    expect(() => parsePageRanges("abc", 10)).toThrow(/could not read/i);
  });
});
