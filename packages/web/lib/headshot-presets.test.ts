import { describe, it, expect, beforeEach } from "vitest";
import { createPreset, deletePreset, getPreset, listPresets, renamePreset, updatePreset } from "./headshot-presets";

// The suite runs in the node environment, so provide a minimal in-memory
// localStorage instead of pulling in jsdom.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
});

const base = { name: "Gold rim", frameId: "circle", preview: "data:image/png;base64,x", includeCompany: false };

describe("headshot presets store", () => {
  it("creates and lists newest first", () => {
    createPreset({ ...base, name: "One", style: { fontId: "inter" } });
    createPreset({ ...base, name: "Two", style: { fontId: "oswald" } });
    const list = listPresets();
    expect(list.map((p) => p.name)).toEqual(["Two", "One"]);
  });

  it("strips companyText unless includeCompany", () => {
    const a = createPreset({ ...base, includeCompany: false, style: { companyText: "SPARK", fontId: "inter" } });
    expect(a.style.companyText).toBeUndefined();
    const b = createPreset({ ...base, includeCompany: true, style: { companyText: "SPARK", fontId: "inter" } });
    expect(b.style.companyText).toBe("SPARK");
  });

  it("updates a preset in place and re-strips company on toggle", () => {
    const p = createPreset({ ...base, includeCompany: true, style: { companyText: "SPARK" } });
    const u = updatePreset(p.id, { includeCompany: false, style: { companyText: "SPARK", fontId: "dm-sans" } });
    expect(u?.includeCompany).toBe(false);
    expect(u?.style.companyText).toBeUndefined();
    expect(u?.style.fontId).toBe("dm-sans");
  });

  it("renames and deletes", () => {
    const p = createPreset({ ...base, style: {} });
    renamePreset(p.id, "Renamed");
    expect(getPreset(p.id)?.name).toBe("Renamed");
    deletePreset(p.id);
    expect(getPreset(p.id)).toBeUndefined();
    expect(listPresets()).toHaveLength(0);
  });

  it("falls back to a default name when blank", () => {
    const p = createPreset({ ...base, name: "   ", style: {} });
    expect(p.name).toBe("Untitled preset");
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("ee.headshotPresets", "not json");
    expect(listPresets()).toEqual([]);
  });
});
