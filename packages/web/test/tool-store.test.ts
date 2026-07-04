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
  it("seeds the default groups in order with labels", () => {
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
    expect(ids(toolsInGroup(s, TOOLS, "images"))).toEqual(["sorter", "studio", "heic", "resize"]);
    expect(ids(toolsInGroup(s, TOOLS, "media"))).toEqual([
      "transcribe",
      "convert",
      "video",
      "splice",
    ]);
  });
});

describe("visibleTools", () => {
  it("shows favourites when the active group is FAV", () => {
    const s = { ...seedState(), favourites: ["convert", "slice"] };
    expect(ids(visibleTools(s, TOOLS, FAV, ""))).toEqual(["slice", "convert"]);
  });
  it("shows a group's tools when a group is active", () => {
    const s = seedState();
    expect(ids(visibleTools(s, TOOLS, "documents", ""))).toEqual(["slice", "pdf"]);
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
  it("unions in a default group missing from a pre-existing persisted state (e.g. Build #8), keeping qr visible", () => {
    // Shaped like a real Build #8 localStorage blob: predates the "utilities" group.
    const build8State = {
      version: 1,
      groups: ["events", "images", "media", "documents"],
      groupLabels: { events: "Events", images: "Images", media: "Media", documents: "Documents" },
      membership: {},
      favourites: [],
    };
    const s = parseToolShell(JSON.stringify(build8State));
    expect(s.groups).toContain("utilities");
    expect(s.groupLabels.utilities).toBe("Utilities");
    // Persisted order/customizations are preserved; the missing default is appended, not inserted.
    expect(s.groups).toEqual(["events", "images", "media", "documents", "utilities"]);
    expect(effectiveGroups(s, toolById("qr")!).length).toBeGreaterThan(0);
  });
});
