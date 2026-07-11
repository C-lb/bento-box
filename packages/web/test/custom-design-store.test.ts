import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadCustomDesign, saveCustomDesign, clearCustomDesign } from "../components/custom-design-store";
import type { CustomDesign } from "@event-editor/core/custom-design";

const design: CustomDesign = { v: 1, page: { width: 100, height: 50 }, background: null, elements: [] };

describe("custom-design-store", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  it("round-trips a design per tool", () => {
    saveCustomDesign("certificate", design);
    expect(loadCustomDesign("certificate")).toEqual(design);
    expect(loadCustomDesign("badge")).toBeUndefined();
  });

  it("clears", () => {
    saveCustomDesign("certificate", design);
    clearCustomDesign("certificate");
    expect(loadCustomDesign("certificate")).toBeUndefined();
  });

  it("rejects malformed payloads", () => {
    (window as unknown as { localStorage: Storage }).localStorage.setItem("ee.customDesign.certificate", "{\"v\":99}");
    expect(loadCustomDesign("certificate")).toBeUndefined();
  });
});
