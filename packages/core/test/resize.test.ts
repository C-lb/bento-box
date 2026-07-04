import { describe, it, expect } from "vitest";
import { normalizeResizeOpts, resizeOutName, sharpFormat } from "../src/resize.js";

describe("normalizeResizeOpts", () => {
  it("defaults to keep format, no bounds, quality 80", () => {
    expect(normalizeResizeOpts({})).toEqual({ maxW: null, maxH: null, format: "keep", quality: 80 });
  });
  it("parses positive integer bounds and drops junk", () => {
    expect(normalizeResizeOpts({ maxW: 1920, maxH: 0 })).toMatchObject({ maxW: 1920, maxH: null });
    expect(normalizeResizeOpts({ maxW: -5 }).maxW).toBeNull();
  });
  it("clamps quality", () => {
    expect(normalizeResizeOpts({ quality: 999 }).quality).toBe(100);
  });
  it("guards format", () => {
    expect(normalizeResizeOpts({ format: "tiff" }).format).toBe("keep");
    expect(normalizeResizeOpts({ format: "webp" }).format).toBe("webp");
  });
});

describe("sharpFormat", () => {
  it("infers from source when keep", () => {
    expect(sharpFormat("keep", "a.png")).toBe("png");
    expect(sharpFormat("keep", "a.jpeg")).toBe("jpeg");
    expect(sharpFormat("keep", "a.bmp")).toBe("jpeg"); // fallback
  });
  it("uses the explicit format otherwise", () => {
    expect(sharpFormat("webp", "a.png")).toBe("webp");
    expect(sharpFormat("jpg", "a.png")).toBe("jpeg");
  });
});

describe("resizeOutName", () => {
  it("keeps original extension when keep", () => {
    expect(resizeOutName("Beach.PNG", "keep", "png")).toBe("Beach.png");
  });
  it("swaps to the chosen format", () => {
    expect(resizeOutName("Beach.png", "webp", "png")).toBe("Beach.webp");
  });
});
