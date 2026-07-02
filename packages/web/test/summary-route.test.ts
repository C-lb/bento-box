import { describe, it, expect } from "vitest";
import { spliceSelection } from "../lib/summary-splice";

describe("spliceSelection", () => {
  it("replaces the selected span", () => {
    expect(spliceSelection("hello world", 6, 11, "there")).toBe("hello there");
  });
  it("clamps out-of-range indices", () => {
    expect(spliceSelection("abc", -5, 99, "X")).toBe("X");
  });
});
