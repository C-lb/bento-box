import { describe, it, expect } from "vitest";
import { toolById } from "@/components/tools";
import {
  seedState,
  effectiveGroups,
  toggleFavourite,
  setMembership,
  slugify,
  createGroup,
  renameGroup,
  deleteGroup,
  reorderGroups,
} from "@/components/tool-store";

const sorter = toolById("sorter")!;

describe("toggleFavourite", () => {
  it("adds then removes a favourite without mutating input", () => {
    const s0 = seedState();
    const s1 = toggleFavourite(s0, "slice");
    expect(s1.favourites).toEqual(["slice"]);
    expect(s0.favourites).toEqual([]); // input untouched
    expect(toggleFavourite(s1, "slice").favourites).toEqual([]);
  });
});

describe("setMembership", () => {
  it("materialises the override from defaultGroups on first edit", () => {
    const s = setMembership(seedState(), sorter, "media", true);
    expect(s.membership.sorter.sort()).toEqual(["events", "images", "media"].sort());
  });
  it("removes a group and keeps the rest", () => {
    const s = setMembership(seedState(), sorter, "events", false);
    expect(s.membership.sorter).toEqual(["images"]);
  });
  it("is idempotent when adding an existing group", () => {
    const s = setMembership(seedState(), sorter, "images", true);
    expect(effectiveGroups(s, sorter).sort()).toEqual(["events", "images"].sort());
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("  Client Weddings! ")).toBe("client-weddings");
  });
  it("falls back to 'group' for empty input", () => {
    expect(slugify("!!!")).toBe("group");
  });
});

describe("createGroup", () => {
  it("appends a slugged group with its label and returns the id", () => {
    const { state, id } = createGroup(seedState(), "Weddings");
    expect(id).toBe("weddings");
    expect(state.groups).toContain("weddings");
    expect(state.groupLabels.weddings).toBe("Weddings");
  });
  it("dedupes a colliding slug with a numeric suffix", () => {
    const first = createGroup(seedState(), "Events"); // collides with seed "events"
    expect(first.id).toBe("events-2");
  });
  it("adds the tool to the new group when addToolId is given", () => {
    const { state, id } = createGroup(seedState(), "Weddings", "slice");
    expect(state.membership.slice).toContain(id);
  });
});

describe("renameGroup", () => {
  it("changes the label only, not the id or order", () => {
    const s = renameGroup(seedState(), "images", "Pictures");
    expect(s.groups).toContain("images");
    expect(s.groupLabels.images).toBe("Pictures");
  });
});

describe("deleteGroup", () => {
  it("removes the group and strips it from every membership override", () => {
    const withOverride = setMembership(seedState(), sorter, "media", true);
    const s = deleteGroup(withOverride, "media");
    expect(s.groups).not.toContain("media");
    expect(s.groupLabels.media).toBeUndefined();
    expect(s.membership.sorter).not.toContain("media");
  });
});

describe("reorderGroups", () => {
  it("applies a new order, keeping only known ids", () => {
    const s = reorderGroups(seedState(), ["documents", "images", "nope", "events", "media"]);
    expect(s.groups).toEqual(["documents", "images", "events", "media"]);
  });
});
