import { describe, it, expect, beforeEach } from "vitest";
import { loadDesign, saveDesign, clearDesign } from "./design-store";
import type { DesignOverrides } from "@event-editor/core/design";

// No jsdom in this suite (environment: "node" in vitest.config.ts) — stub the
// slice of `window.localStorage` the store touches, mirroring the pattern in
// lib/shorten-history.test.ts's sibling suites for browser-only modules.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };

describe("design-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns undefined when nothing is persisted", () => {
    expect(loadDesign("certificate")).toBeUndefined();
  });

  it("round-trips a saved design", () => {
    const o: DesignOverrides = {
      v: 1,
      pageSize: { width: 595, height: 842 },
      text: { recipient: { fontId: "inter", size: 24 } },
    };
    saveDesign("certificate", o);
    expect(loadDesign("certificate")).toEqual(o);
  });

  it("keys designs per tool", () => {
    saveDesign("certificate", { v: 1, pageSize: { width: 1, height: 2 } });
    saveDesign("badge", { v: 1, pageSize: { width: 3, height: 4 } });
    expect(loadDesign("certificate")).toEqual({ v: 1, pageSize: { width: 1, height: 2 } });
    expect(loadDesign("badge")).toEqual({ v: 1, pageSize: { width: 3, height: 4 } });
  });

  it("returns undefined for garbage JSON", () => {
    window.localStorage.setItem("ee.design.certificate", "not json{{{");
    expect(loadDesign("certificate")).toBeUndefined();
  });

  it("returns undefined for a non-object value", () => {
    window.localStorage.setItem("ee.design.certificate", JSON.stringify("just a string"));
    expect(loadDesign("certificate")).toBeUndefined();
  });

  it("returns undefined for an unrecognised version", () => {
    window.localStorage.setItem("ee.design.certificate", JSON.stringify({ v: 2, pageSize: { width: 1, height: 2 } }));
    expect(loadDesign("certificate")).toBeUndefined();
  });

  it("returns undefined for a missing version", () => {
    window.localStorage.setItem("ee.design.certificate", JSON.stringify({ pageSize: { width: 1, height: 2 } }));
    expect(loadDesign("certificate")).toBeUndefined();
  });

  it("clear removes the persisted design", () => {
    saveDesign("certificate", { v: 1 });
    clearDesign("certificate");
    expect(loadDesign("certificate")).toBeUndefined();
  });

  it("clear is a no-op when nothing was persisted", () => {
    expect(() => clearDesign("certificate")).not.toThrow();
  });
});
