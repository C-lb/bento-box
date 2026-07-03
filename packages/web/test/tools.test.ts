import { describe, it, expect } from "vitest";
import { TOOLS, toolById, searchTools } from "@/components/tools";

const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

describe("TOOLS registry", () => {
  it("has the five current tools with unique ids and hrefs", () => {
    expect(ids(TOOLS)).toEqual(["sorter", "studio", "transcribe", "slice", "convert"]);
    expect(new Set(ids(TOOLS)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.href)).size).toBe(TOOLS.length);
  });
  it("gives every tool at least one default group and one tag, all lowercase", () => {
    for (const t of TOOLS) {
      expect(t.defaultGroups.length).toBeGreaterThan(0);
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.tags.every((tag) => tag === tag.toLowerCase())).toBe(true);
    }
  });
});

describe("toolById", () => {
  it("finds a tool", () => {
    expect(toolById("slice")?.href).toBe("/slice");
  });
  it("returns undefined for an unknown id", () => {
    expect(toolById("nope")).toBeUndefined();
  });
});

describe("searchTools", () => {
  it("returns all tools for an empty or whitespace query", () => {
    expect(searchTools(TOOLS, "")).toHaveLength(TOOLS.length);
    expect(searchTools(TOOLS, "   ")).toHaveLength(TOOLS.length);
  });
  it("matches a tag", () => {
    expect(ids(searchTools(TOOLS, "mp3"))).toContain("convert");
  });
  it("matches the title", () => {
    expect(ids(searchTools(TOOLS, "headshot"))).toContain("studio");
  });
  it("matches the body text", () => {
    expect(ids(searchTools(TOOLS, "timestamped"))).toContain("transcribe");
  });
  it("is case-insensitive and trims", () => {
    expect(ids(searchTools(TOOLS, "  MP3 "))).toContain("convert");
  });
  it("returns registry order for matches", () => {
    const r = searchTools(TOOLS, "image");
    expect(ids(r)).toEqual(TOOLS.filter((t) => ids(r).includes(t.id)).map((t) => t.id));
  });
  it("returns empty for no match", () => {
    expect(searchTools(TOOLS, "zzzznomatch")).toEqual([]);
  });
});
