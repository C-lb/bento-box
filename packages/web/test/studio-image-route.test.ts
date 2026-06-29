import { describe, it, expect } from "vitest";
import { isContained } from "../app/api/studio/image/[id]/contain";

describe("headshot image path containment", () => {
  it("accepts paths inside the headshot dir", () => {
    expect(isContained("/data/headshots", "/data/headshots/12.png")).toBe(true);
  });
  it("rejects traversal outside the headshot dir", () => {
    expect(isContained("/data/headshots", "/data/headshots/../../etc/passwd")).toBe(false);
  });
});
