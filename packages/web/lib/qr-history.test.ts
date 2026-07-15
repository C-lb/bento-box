import { describe, it, expect } from "vitest";
import {
  parseQrHistory,
  addQrHistoryItem,
  removeQrHistoryItem,
  seedQrHistory,
  type QrHistoryItem,
  type QrHistoryState,
} from "./qr-history";

function item(overrides: Partial<QrHistoryItem> = {}): QrHistoryItem {
  return {
    id: "id-1",
    text: "https://example.com",
    at: 1,
    size: 512,
    ecc: "M",
    fg: "#000000",
    bg: "#ffffff",
    format: "png",
    ...overrides,
  };
}

describe("parseQrHistory", () => {
  it("returns an empty seed state for null input", () => {
    expect(parseQrHistory(null)).toEqual({ v: 1, items: [] });
  });

  it("returns an empty seed state for invalid JSON", () => {
    expect(parseQrHistory("not json")).toEqual({ v: 1, items: [] });
  });

  it("returns an empty seed state for the wrong version", () => {
    expect(parseQrHistory(JSON.stringify({ v: 2, items: [] }))).toEqual({ v: 1, items: [] });
  });

  it("returns an empty seed state when items is not an array", () => {
    expect(parseQrHistory(JSON.stringify({ v: 1, items: "nope" }))).toEqual({ v: 1, items: [] });
  });

  it("filters out malformed items", () => {
    const good = item();
    const raw = JSON.stringify({
      v: 1,
      items: [
        good,
        { id: "x", text: "no options" }, // missing fields
        null,
        "not an object",
        item({ ecc: "Z" as never }), // bad ecc
        item({ format: "gif" as never }), // bad format
        item({ size: "512" as never }), // wrong type
      ],
    });
    expect(parseQrHistory(raw)).toEqual({ v: 1, items: [good] });
  });

  it("caps at 20 items", () => {
    const items = Array.from({ length: 25 }, (_, i) => item({ id: `id-${i}`, at: i }));
    const result = parseQrHistory(JSON.stringify({ v: 1, items }));
    expect(result.items).toHaveLength(20);
    expect(result.items[0].at).toBe(0);
  });
});

describe("addQrHistoryItem", () => {
  it("prepends the new item so newest is first", () => {
    const state: QrHistoryState = { v: 1, items: [item({ id: "old", text: "old" })] };
    const next = addQrHistoryItem(state, item({ id: "new", text: "new", at: 2 }));
    expect(next.items[0].id).toBe("new");
    expect(next.items[1].id).toBe("old");
  });

  it("caps the result at 20 items, dropping the oldest", () => {
    const state: QrHistoryState = {
      v: 1,
      items: Array.from({ length: 20 }, (_, i) => item({ id: `id-${i}`, text: `t${i}`, at: i })),
    };
    const next = addQrHistoryItem(state, item({ id: "new", text: "new", at: 999 }));
    expect(next.items).toHaveLength(20);
    expect(next.items[0].id).toBe("new");
    expect(next.items.some((i) => i.at === 19)).toBe(false); // oldest dropped
  });

  it("replaces the top entry instead of stacking a consecutive duplicate", () => {
    const state: QrHistoryState = { v: 1, items: [item({ id: "a", at: 1 })] };
    const next = addQrHistoryItem(state, item({ id: "b", at: 2 }));
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ id: "b", at: 2 });
  });

  it("does not dedupe when any option differs", () => {
    const state: QrHistoryState = { v: 1, items: [item({ id: "a" })] };
    const next = addQrHistoryItem(state, item({ id: "b", size: 256 }));
    expect(next.items).toHaveLength(2);
  });

  it("does not dedupe against non-head entries", () => {
    const state: QrHistoryState = {
      v: 1,
      items: [item({ id: "a", text: "other" }), item({ id: "b" })],
    };
    const next = addQrHistoryItem(state, item({ id: "c" }));
    expect(next.items).toHaveLength(3);
  });
});

describe("removeQrHistoryItem", () => {
  it("removes only the matching item", () => {
    const state: QrHistoryState = { v: 1, items: [item({ id: "a" }), item({ id: "b" })] };
    const next = removeQrHistoryItem(state, "a");
    expect(next.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("is a no-op for an unknown id", () => {
    const state: QrHistoryState = { v: 1, items: [item({ id: "a" })] };
    expect(removeQrHistoryItem(state, "nope").items).toHaveLength(1);
  });
});

describe("seedQrHistory", () => {
  it("returns an empty v1 state", () => {
    expect(seedQrHistory()).toEqual({ v: 1, items: [] });
  });
});
