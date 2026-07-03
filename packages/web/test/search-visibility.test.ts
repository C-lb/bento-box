import { describe, it, expect } from "vitest";
import { nextSearchVisibility } from "@/components/tool-store";

describe("nextSearchVisibility", () => {
  it("is visible at or above the threshold regardless of direction", () => {
    expect(nextSearchVisibility(500, 4, 8)).toBe(true);
    expect(nextSearchVisibility(0, 8, 8)).toBe(true);
  });
  it("hides when scrolling down past the threshold", () => {
    expect(nextSearchVisibility(100, 160, 8)).toBe(false);
  });
  it("reveals when scrolling up past the threshold", () => {
    expect(nextSearchVisibility(400, 320, 8)).toBe(true);
  });
  it("holds visible when there is no vertical movement", () => {
    expect(nextSearchVisibility(300, 300, 8)).toBe(true);
  });
});
