import { describe, it, expect, beforeEach } from "vitest";
import {
  captureUploadFontIds,
  createPreset,
  deletePreset,
  getPreset,
  listPresets,
  renamePreset,
  updatePreset,
  type DesignPresetCapture,
} from "../lib/design-presets";
import type { CustomDesign } from "@event-editor/core/custom-design";

// The suite runs in the node environment, so provide a minimal in-memory
// localStorage instead of pulling in jsdom (mirrors headshot-presets.test.ts).
let store: Map<string, string>;
beforeEach(() => {
  store = new Map<string, string>();
  (globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
});

const designCapture: DesignPresetCapture = {
  kind: "design",
  layoutId: "classic",
  overrides: { v: 1, lineGap: 12, text: { title: { fontId: "oswald", size: 30 } } },
};

const customDesign: CustomDesign = {
  v: 1,
  page: { width: 841.89, height: 595.28 },
  background: { assetId: "bg-1", kind: "png" },
  elements: [
    { id: "e1", type: "text", text: "Hello", x: 10, y: 10, w: 200, h: 40, size: 18, color: "#111111", align: "left", fontId: "upload:abc" },
    { id: "e2", type: "image", assetId: "img-1", x: 10, y: 60, w: 100, h: 100 },
  ],
};

const customCapture: DesignPresetCapture = { kind: "custom", customDesign };

describe("design presets store", () => {
  it("creates and lists newest first", () => {
    createPreset("badge", { name: "One", preview: "", capture: designCapture });
    createPreset("badge", { name: "Two", preview: "", capture: designCapture });
    expect(listPresets("badge").map((p) => p.name)).toEqual(["Two", "One"]);
  });

  it("keeps tools isolated by key", () => {
    createPreset("badge", { name: "Badge look", preview: "", capture: designCapture });
    createPreset("ticket", { name: "Ticket look", preview: "", capture: designCapture });
    expect(listPresets("badge").map((p) => p.name)).toEqual(["Badge look"]);
    expect(listPresets("ticket").map((p) => p.name)).toEqual(["Ticket look"]);
    expect(store.has("ee.designPresets.badge")).toBe(true);
    expect(store.has("ee.designPresets.ticket")).toBe(true);
  });

  it("round-trips a design-kind capture", () => {
    const p = createPreset("certificate", { name: "Classic", preview: "data:image/png;base64,x", capture: designCapture })!;
    const got = getPreset("certificate", p.id)!;
    expect(got.kind).toBe("design");
    if (got.kind === "design") {
      expect(got.layoutId).toBe("classic");
      expect(got.overrides.lineGap).toBe(12);
      expect(got.overrides.text?.title?.fontId).toBe("oswald");
    }
    expect(got.preview).toBe("data:image/png;base64,x");
  });

  it("round-trips a custom-kind capture", () => {
    const p = createPreset("badge", { name: "My canvas", preview: "", capture: customCapture })!;
    const got = getPreset("badge", p.id)!;
    expect(got.kind).toBe("custom");
    if (got.kind === "custom") {
      expect(got.customDesign.background?.assetId).toBe("bg-1");
      expect(got.customDesign.elements).toHaveLength(2);
    }
  });

  it("updates a preset in place, replacing the capture across kinds", () => {
    const p = createPreset("badge", { name: "Look", preview: "", capture: customCapture })!;
    const u = updatePreset("badge", p.id, { preview: "data:,new", capture: designCapture })!;
    expect(u.kind).toBe("design");
    expect(u.preview).toBe("data:,new");
    // no stale custom fields linger in storage
    const raw = JSON.parse(store.get("ee.designPresets.badge")!) as Record<string, unknown>[];
    expect(raw[0].customDesign).toBeUndefined();
    expect(raw[0].layoutId).toBe("classic");
  });

  it("renames and deletes", () => {
    const p = createPreset("badge", { name: "Old", preview: "", capture: designCapture })!;
    renamePreset("badge", p.id, "New name");
    expect(getPreset("badge", p.id)?.name).toBe("New name");
    deletePreset("badge", p.id);
    expect(getPreset("badge", p.id)).toBeUndefined();
    expect(listPresets("badge")).toHaveLength(0);
  });

  it("falls back to a default name when blank", () => {
    const p = createPreset("badge", { name: "   ", preview: "", capture: designCapture })!;
    expect(p.name).toBe("Untitled preset");
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("ee.designPresets.badge", "not json");
    expect(listPresets("badge")).toEqual([]);
  });

  it("sanitizes overrides on read (clamps and drops invalid entries)", () => {
    localStorage.setItem("ee.designPresets.certificate", JSON.stringify([
      // out-of-range lineGap gets clamped by sanitizeDesignOverrides
      { id: "a", name: "Clamped", preview: "", updatedAt: 2, kind: "design", layoutId: "classic", overrides: { v: 1, lineGap: 999 } },
      // wrong overrides version: entry dropped
      { id: "b", name: "Bad overrides", preview: "", updatedAt: 1, kind: "design", layoutId: "classic", overrides: { v: 2 } },
      // unknown kind: entry dropped
      { id: "c", name: "Bad kind", preview: "", updatedAt: 1, kind: "wat" },
      // custom without a valid design: entry dropped
      { id: "d", name: "Bad custom", preview: "", updatedAt: 1, kind: "custom", customDesign: { v: 2 } },
    ]));
    const list = listPresets("certificate");
    expect(list.map((p) => p.id)).toEqual(["a"]);
    expect(list[0].kind === "design" && list[0].overrides.lineGap).toBe(60);
  });

  it("rejects an unusable capture at create time", () => {
    const bad = { kind: "design", layoutId: "", overrides: { v: 1 } } as unknown as DesignPresetCapture;
    expect(createPreset("badge", { name: "x", preview: "", capture: bad })).toBeUndefined();
    expect(listPresets("badge")).toEqual([]);
  });

  it("lists uploaded session font ids referenced by a capture", () => {
    expect(captureUploadFontIds(designCapture)).toEqual([]);
    expect(captureUploadFontIds(customCapture)).toEqual(["upload:abc"]);
    const withUpload: DesignPresetCapture = {
      kind: "design",
      layoutId: "classic",
      overrides: { v: 1, text: { title: { fontId: "upload:xyz" }, body: { fontId: "inter" } } },
    };
    expect(captureUploadFontIds(withUpload)).toEqual(["upload:xyz"]);
  });
});
