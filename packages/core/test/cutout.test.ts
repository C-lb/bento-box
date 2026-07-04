import { describe, it, expect } from "vitest";
import { cutoutOutName, normalizeBgFill } from "../src/cutout.js";

describe("cutoutOutName", () => {
  it("swaps any extension to -cutout.png", () => {
    expect(cutoutOutName("IMG_1234.JPG")).toBe("IMG_1234-cutout.png");
    expect(cutoutOutName("headshot.heic")).toBe("headshot-cutout.png");
  });
  it("sanitises and handles no extension", () => {
    expect(cutoutOutName("my photo")).toBe("my_photo-cutout.png");
  });
});

describe("normalizeBgFill", () => {
  it("defaults to transparent", () => {
    expect(normalizeBgFill({})).toBe("transparent");
    expect(normalizeBgFill({ mode: "transparent" })).toBe("transparent");
  });
  it("maps white to #ffffff", () => {
    expect(normalizeBgFill({ mode: "white" })).toEqual({ color: "#ffffff" });
  });
  it("accepts a valid custom hex", () => {
    expect(normalizeBgFill({ mode: "custom", color: "#12ab34" })).toEqual({ color: "#12ab34" });
  });
  it("falls back to transparent on junk colour", () => {
    expect(normalizeBgFill({ mode: "custom", color: "red" })).toBe("transparent");
  });
});
