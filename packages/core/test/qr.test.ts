import { describe, it, expect } from "vitest";
import { normalizeQrOpts } from "../src/qr.js";

describe("normalizeQrOpts", () => {
  it("applies defaults", () => {
    expect(normalizeQrOpts({})).toEqual({
      size: 512, ecc: "M", fg: "#000000", bg: "#ffffff", format: "png",
    });
  });
  it("clamps size", () => {
    expect(normalizeQrOpts({ size: 10 }).size).toBe(128);
    expect(normalizeQrOpts({ size: 9999 }).size).toBe(1024);
  });
  it("guards ecc and format", () => {
    expect(normalizeQrOpts({ ecc: "Z" as never }).ecc).toBe("M");
    expect(normalizeQrOpts({ ecc: "H" }).ecc).toBe("H");
    expect(normalizeQrOpts({ format: "gif" }).format).toBe("png");
  });
  it("rejects malformed hex colours", () => {
    expect(normalizeQrOpts({ fg: "red" }).fg).toBe("#000000");
    expect(normalizeQrOpts({ fg: "#123abc" }).fg).toBe("#123abc");
  });
});
