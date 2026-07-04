import { describe, it, expect } from "vitest";
import { normalizeHeicOpts, heicOutName } from "../src/heic.js";

describe("normalizeHeicOpts", () => {
  it("defaults to jpg at quality 82", () => {
    expect(normalizeHeicOpts({})).toEqual({ format: "jpg", quality: 82 });
  });
  it("clamps quality into 1..100", () => {
    expect(normalizeHeicOpts({ quality: 0 }).quality).toBe(1);
    expect(normalizeHeicOpts({ quality: 500 }).quality).toBe(100);
  });
  it("accepts png and ignores unknown formats", () => {
    expect(normalizeHeicOpts({ format: "png" }).format).toBe("png");
    expect(normalizeHeicOpts({ format: "gif" }).format).toBe("jpg");
  });
});

describe("heicOutName", () => {
  it("swaps the extension to the chosen format", () => {
    expect(heicOutName("IMG_0421.HEIC", "png")).toBe("IMG_0421.png");
  });
});
