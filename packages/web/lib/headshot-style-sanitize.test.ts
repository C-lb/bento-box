import { describe, it, expect } from "vitest";
import { sanitizeStyle } from "./headshot-style-sanitize";

describe("sanitizeStyle", () => {
  it("returns undefined for an all-default / empty style", () => {
    expect(sanitizeStyle(undefined)).toBeUndefined();
    expect(sanitizeStyle({})).toBeUndefined();
    expect(sanitizeStyle({ bold: false, zoom: 1 })).toBeUndefined();
  });

  it("keeps the legacy fields", () => {
    expect(sanitizeStyle({ bold: true, italic: true, uppercase: true })).toMatchObject({
      bold: true,
      italic: true,
      uppercase: true,
    });
  });

  it("only allows a #rrggbb text colour", () => {
    expect(sanitizeStyle({ color: "#abcdef" })).toMatchObject({ color: "#abcdef" });
    expect(sanitizeStyle({ color: "red" })).toBeUndefined();
    expect(sanitizeStyle({ color: "#fff" })).toBeUndefined();
    expect(sanitizeStyle({ color: "#000000;stroke=x" })).toBeUndefined();
  });

  it("clamps zoom and offsets", () => {
    expect(sanitizeStyle({ zoom: 9 })).toMatchObject({ zoom: 3 });
    expect(sanitizeStyle({ zoom: 0 })).toBeUndefined(); // clamps to 1 ⇒ not meaningful
    expect(sanitizeStyle({ offsetX: -5, offsetY: 5 })).toMatchObject({ offsetX: -1, offsetY: 1 });
    expect(sanitizeStyle({ offsetX: 0, offsetY: 0 })).toBeUndefined();
  });

  it("accepts a known fontId and drops an unknown one", () => {
    expect(sanitizeStyle({ fontId: "inter" })).toMatchObject({ fontId: "inter" });
    expect(sanitizeStyle({ fontId: "comic-sans" })).toBeUndefined();
    expect(sanitizeStyle({ fontId: 42 })).toBeUndefined();
  });

  it("trims and caps companyText, dropping blank", () => {
    expect(sanitizeStyle({ companyText: "SPARK" })).toMatchObject({ companyText: "SPARK" });
    expect(sanitizeStyle({ companyText: "   " })).toBeUndefined();
    const long = sanitizeStyle({ companyText: "x".repeat(500) });
    expect(long?.companyText?.length).toBe(120);
  });

  it("sanitizes per-line styles and clamps size/tracking", () => {
    const s = sanitizeStyle({ name: { bold: true, size: 999, tracking: 200 }, title: { size: 5 } });
    expect(s?.name).toMatchObject({ bold: true, size: 160, tracking: 60 });
    expect(s?.title).toMatchObject({ size: 12 });
  });

  it("drops an empty per-line object", () => {
    expect(sanitizeStyle({ name: { tracking: 0 } })).toBeUndefined();
    expect(sanitizeStyle({ name: {} })).toBeUndefined();
  });

  it("accepts a solid rim and rejects a non-hex colour", () => {
    expect(sanitizeStyle({ rim: { mode: "solid", width: 20, color: "#112233" } })?.rim).toMatchObject({
      mode: "solid",
      width: 20,
      color: "#112233",
    });
    expect(sanitizeStyle({ rim: { mode: "solid", width: 20, color: "url(#x)" } })).toBeUndefined();
  });

  it("accepts a gradient rim, normalizes angle, requires both stops", () => {
    const s = sanitizeStyle({ rim: { mode: "gradient", width: 24, from: "#ff00ff", to: "#7c3aed", angle: 405 } });
    expect(s?.rim).toMatchObject({ mode: "gradient", from: "#ff00ff", to: "#7c3aed", angle: 45 });
    expect(sanitizeStyle({ rim: { mode: "gradient", width: 24, from: "#ff00ff" } })).toBeUndefined();
    expect(sanitizeStyle({ rim: { mode: "wat", width: 24 } })).toBeUndefined();
  });

  it("clamps rim width and defaults it when absent", () => {
    expect(sanitizeStyle({ rim: { mode: "solid", width: 999, color: "#000000" } })?.rim?.width).toBe(80);
    expect(sanitizeStyle({ rim: { mode: "solid", color: "#000000" } })?.rim?.width).toBe(12);
  });

  it("keeps transparentBg", () => {
    expect(sanitizeStyle({ transparentBg: true })).toMatchObject({ transparentBg: true });
  });
});
