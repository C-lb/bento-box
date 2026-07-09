import { describe, it, expect } from "vitest";
import {
  parseShortenHistory,
  addShortenHistoryItem,
  seedShortenHistory,
  type ShortenHistoryState,
} from "./shorten-history";

describe("parseShortenHistory", () => {
  it("returns an empty seed state for null input", () => {
    expect(parseShortenHistory(null)).toEqual({ v: 1, items: [] });
  });

  it("returns an empty seed state for invalid JSON", () => {
    expect(parseShortenHistory("not json")).toEqual({ v: 1, items: [] });
  });

  it("returns an empty seed state for the wrong version", () => {
    expect(parseShortenHistory(JSON.stringify({ v: 2, items: [] }))).toEqual({ v: 1, items: [] });
  });

  it("returns an empty seed state when items is not an array", () => {
    expect(parseShortenHistory(JSON.stringify({ v: 1, items: "nope" }))).toEqual({
      v: 1,
      items: [],
    });
  });

  it("filters out malformed items", () => {
    const raw = JSON.stringify({
      v: 1,
      items: [
        { long: "https://example.com/a", short: "https://is.gd/a", at: 1 },
        { long: "https://example.com/b" }, // missing short/at
        null,
        "not an object",
        { long: 1, short: "https://is.gd/c", at: 2 }, // wrong type
      ],
    });
    expect(parseShortenHistory(raw)).toEqual({
      v: 1,
      items: [{ long: "https://example.com/a", short: "https://is.gd/a", at: 1 }],
    });
  });

  it("caps at 20 items", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      long: `https://example.com/${i}`,
      short: `https://is.gd/${i}`,
      at: i,
    }));
    const result = parseShortenHistory(JSON.stringify({ v: 1, items }));
    expect(result.items).toHaveLength(20);
    expect(result.items[0].at).toBe(0);
  });
});

describe("addShortenHistoryItem", () => {
  it("prepends the new item so newest is first", () => {
    const state: ShortenHistoryState = {
      v: 1,
      items: [{ long: "https://example.com/old", short: "https://is.gd/old", at: 1 }],
    };
    const next = addShortenHistoryItem(state, {
      long: "https://example.com/new",
      short: "https://is.gd/new",
      at: 2,
    });
    expect(next.items[0].short).toBe("https://is.gd/new");
    expect(next.items[1].short).toBe("https://is.gd/old");
  });

  it("caps the result at 20 items, dropping the oldest", () => {
    const state: ShortenHistoryState = {
      v: 1,
      items: Array.from({ length: 20 }, (_, i) => ({
        long: `https://example.com/${i}`,
        short: `https://is.gd/${i}`,
        at: i,
      })),
    };
    const next = addShortenHistoryItem(state, {
      long: "https://example.com/new",
      short: "https://is.gd/new",
      at: 999,
    });
    expect(next.items).toHaveLength(20);
    expect(next.items[0].short).toBe("https://is.gd/new");
    expect(next.items.some((i) => i.at === 19)).toBe(false); // oldest dropped
  });
});

describe("seedShortenHistory", () => {
  it("returns an empty v1 state", () => {
    expect(seedShortenHistory()).toEqual({ v: 1, items: [] });
  });
});
