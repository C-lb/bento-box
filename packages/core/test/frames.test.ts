import { describe, it, expect } from "vitest";
import { FRAMES, FRAME_LIST, getFrame } from "../src/frames.js";

describe("frames", () => {
  it("exposes exactly the three 4a frames", () => {
    expect(FRAME_LIST.map((f) => f.id).sort()).toEqual(["circle", "clean-band", "minimal-corner"]);
  });
  it("every frame is a 1080 square with a photo region inside the canvas", () => {
    for (const f of FRAME_LIST) {
      expect(f.canvas).toBe(1080);
      expect(f.photo.x + f.photo.w).toBeLessThanOrEqual(1080);
      expect(f.photo.y + f.photo.h).toBeLessThanOrEqual(1080);
    }
  });
  it("the circle frame uses a circular crop", () => {
    expect(getFrame("circle")!.photo.shape).toBe("circle");
  });
  it("returns undefined for unknown ids", () => {
    expect(getFrame("nope")).toBeUndefined();
  });
});
