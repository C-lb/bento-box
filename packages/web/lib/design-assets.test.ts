import { describe, it, expect, beforeEach } from "vitest";
import { isAssetReferenced } from "./design-assets";

// Runs in the node environment (no jsdom), so provide a minimal in-memory
// localStorage with key()/length so the scan can enumerate keys, mirroring
// design-presets.test.ts.
let store: Map<string, string>;
beforeEach(() => {
  store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
});

describe("isAssetReferenced", () => {
  it("returns false when nothing references the id", () => {
    store.set("ee.customDesign.certificate", JSON.stringify({
      v: 1, page: { width: 100, height: 50 }, background: null, elements: [],
    }));
    expect(isAssetReferenced("bg-1")).toBe(false);
  });

  it("finds a reference via a persisted custom design's background", () => {
    store.set("ee.customDesign.certificate", JSON.stringify({
      v: 1, page: { width: 100, height: 50 }, background: { assetId: "bg-1", kind: "png" }, elements: [],
    }));
    expect(isAssetReferenced("bg-1")).toBe(true);
  });

  it("finds a reference via a persisted custom design's image element", () => {
    store.set("ee.customDesign.badge", JSON.stringify({
      v: 1, page: { width: 100, height: 50 }, background: null,
      elements: [{ id: "e1", type: "image", assetId: "img-1", x: 0, y: 0, w: 10, h: 10 }],
    }));
    expect(isAssetReferenced("img-1")).toBe(true);
  });

  it("finds a reference via a saved preset (custom kind)", () => {
    store.set("ee.designPresets.badge", JSON.stringify([
      {
        id: "p1", name: "Look", preview: "", updatedAt: 1, kind: "custom",
        customDesign: {
          v: 1, page: { width: 100, height: 50 }, background: { assetId: "bg-2", kind: "png" }, elements: [],
        },
      },
    ]));
    expect(isAssetReferenced("bg-2")).toBe(true);
  });

  it("finds a reference via a saved preset's image element", () => {
    store.set("ee.designPresets.ticket", JSON.stringify([
      {
        id: "p1", name: "Look", preview: "", updatedAt: 1, kind: "custom",
        customDesign: {
          v: 1, page: { width: 100, height: 50 }, background: null,
          elements: [{ id: "e1", type: "image", assetId: "img-3", x: 0, y: 0, w: 10, h: 10 }],
        },
      },
    ]));
    expect(isAssetReferenced("img-3")).toBe(true);
  });

  it("finds a future-proof reference via any assetId field nested in a preset (e.g. design overrides.background)", () => {
    store.set("ee.designPresets.certificate", JSON.stringify([
      {
        id: "p1", name: "Look", preview: "", updatedAt: 1, kind: "design", layoutId: "classic",
        overrides: { v: 1, background: { assetId: "bg-4" } },
      },
    ]));
    expect(isAssetReferenced("bg-4")).toBe(true);
  });

  it("skips a malformed (non-JSON) key and does not throw", () => {
    store.set("ee.designPresets.badge", "not json");
    store.set("ee.customDesign.certificate", JSON.stringify({
      v: 1, page: { width: 100, height: 50 }, background: { assetId: "bg-5", kind: "png" }, elements: [],
    }));
    expect(() => isAssetReferenced("bg-5")).not.toThrow();
    expect(isAssetReferenced("bg-5")).toBe(true);
    expect(isAssetReferenced("does-not-exist")).toBe(false);
  });

  it("ignores keys outside the two known prefixes", () => {
    store.set("ee.someOtherThing.certificate", JSON.stringify({ assetId: "bg-6" }));
    expect(isAssetReferenced("bg-6")).toBe(false);
  });

  it("is SSR-safe: returns false when localStorage is undefined", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(isAssetReferenced("anything")).toBe(false);
  });
});
