import { describe, it, expect } from "vitest";
import { TOOLS, toolById } from "@/components/tools";
import {
  FAV,
  DEFAULT_GROUP_ORDER,
  seedState,
  effectiveGroups,
  toolsInGroup,
  visibleTools,
  parseToolShell,
} from "@/components/tool-store";

const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

describe("seedState", () => {
  it("seeds the four default groups in order with labels", () => {
    const s = seedState();
    expect(s.groups).toEqual(DEFAULT_GROUP_ORDER);
    expect(s.groupLabels.images).toBe("Images");
    expect(s.membership).toEqual({});
    expect(s.favourites).toEqual([]);
    expect(s.version).toBe(1);
  });
});

describe("effectiveGroups", () => {
  it("falls back to the tool's defaultGroups when no override", () => {
    const s = seedState();
    expect(effectiveGroups(s, toolById("sorter")!)).toEqual(["images", "events"]);
  });
  it("uses the membership override when present", () => {
    const s = { ...seedState(), membership: { sorter: ["events"] } };
    expect(effectiveGroups(s, toolById("sorter")!)).toEqual(["events"]);
  });
  it("drops group ids that no longer exist in state.groups", () => {
    const s = { ...seedState(), groups: ["images"], groupLabels: { images: "Images" } };
    expect(effectiveGroups(s, toolById("sorter")!)).toEqual(["images"]);
  });
});

describe("toolsInGroup", () => {
  it("returns tools whose effective groups include the id, in registry order", () => {
    const s = seedState();
    expect(ids(toolsInGroup(s, TOOLS, "images"))).toEqual(["sorter", "studio"]);
    expect(ids(toolsInGroup(s, TOOLS, "media"))).toEqual(["transcribe", "convert"]);
  });
});

describe("visibleTools", () => {
  it("shows favourites when the active group is FAV", () => {
    const s = { ...seedState(), favourites: ["convert", "slice"] };
    expect(ids(visibleTools(s, TOOLS, FAV, ""))).toEqual(["slice", "convert"]);
  });
  it("shows a group's tools when a group is active", () => {
    const s = seedState();
    expect(ids(visibleTools(s, TOOLS, "documents", ""))).toEqual(["slice"]);
  });
  it("a live query overrides the active group and searches all tools", () => {
    const s = seedState();
    expect(ids(visibleTools(s, TOOLS, "documents", "mp3"))).toEqual(["convert"]);
  });
});

describe("parseToolShell", () => {
  it("returns a seed for null", () => {
    expect(parseToolShell(null)).toEqual(seedState());
  });
  it("returns a seed for malformed JSON", () => {
    expect(parseToolShell("{not json")).toEqual(seedState());
  });
  it("returns a seed when the version is wrong", () => {
    expect(parseToolShell(JSON.stringify({ version: 99 }))).toEqual(seedState());
  });
  it("round-trips a valid state", () => {
    const s = { ...seedState(), favourites: ["slice"] };
    expect(parseToolShell(JSON.stringify(s))).toEqual(s);
  });
  it("returns a seed when groupLabels or membership is null", () => {
    expect(parseToolShell(JSON.stringify({ version: 1, groups: [], groupLabels: null, membership: {}, favourites: [] }))).toEqual(seedState());
    expect(parseToolShell(JSON.stringify({ version: 1, groups: [], groupLabels: {}, membership: null, favourites: [] }))).toEqual(seedState());
  });
});
