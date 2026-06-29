import { describe, it, expect } from "vitest";
import { glyphPath } from "../lib/text-render";

describe("glyphPath", () => {
  it("returns an svg path with the requested fill", () => {
    const out = glyphPath("Jane Okafor", { x: 64, y: 100, fontSize: 52, anchor: "left", color: "#ffffff" });
    expect(out).toContain("<path");
    expect(out).toContain('fill="#ffffff"');
    expect(out).toMatch(/d="M/); // real glyph path data
  });
  it("returns empty string for empty text", () => {
    expect(glyphPath("", { x: 0, y: 0, fontSize: 30, anchor: "center", color: "#000" })).toBe("");
  });
});
