import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  DESIGNER_FONTS,
  loadFontById,
  addUploadedFont,
  listUploadedFonts,
  getUploadedFont,
} from "./designer-fonts";

const VALID_CATEGORIES = new Set(["sans", "serif", "script", "display", "mono"]);
const KEBAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FONT_FILE = /\.(ttf|otf)$/i;

describe("DESIGNER_FONTS registry shape", () => {
  it("has at least one entry", () => {
    expect(DESIGNER_FONTS.length).toBeGreaterThan(0);
  });

  it("has unique kebab-case ids", () => {
    const ids = DESIGNER_FONTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(KEBAB_ID);
    }
  });

  it("points every entry at a .ttf or .otf file", () => {
    for (const font of DESIGNER_FONTS) {
      expect(font.file).toMatch(FONT_FILE);
    }
  });

  it("uses only valid categories", () => {
    for (const font of DESIGNER_FONTS) {
      expect(VALID_CATEGORIES.has(font.category)).toBe(true);
    }
  });

  it("gives every entry a non-empty label", () => {
    for (const font of DESIGNER_FONTS) {
      expect(font.label.length).toBeGreaterThan(0);
    }
  });
});

describe("loadFontById", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => bytes.buffer,
      } as unknown as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches the font file for a known id", async () => {
    const bytes = await loadFontById("inter");
    expect(globalThis.fetch).toHaveBeenCalledWith("/fonts/designer/inter-regular.ttf");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it("caches so a second load reuses the first fetch", async () => {
    await loadFontById("dm-sans");
    await loadFontById("dm-sans");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown ids without fetching", async () => {
    await expect(loadFontById("not-a-real-font")).rejects.toThrow(/unknown/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("throws when the fetch response is not ok", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;

    await expect(loadFontById("oswald")).rejects.toThrow(/404/);
  });
});

describe("session font uploads", () => {
  it("round-trips an uploaded font's bytes via its returned id", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const id = addUploadedFont("My Custom Font.ttf", bytes);

    expect(id).toBe("upload:My Custom Font.ttf");
    expect(getUploadedFont(id)).toBe(bytes);
  });

  it("lists uploaded fonts alongside their label", () => {
    addUploadedFont("Another Font.otf", new Uint8Array([1]));
    const listed = listUploadedFonts();
    expect(listed.some((f) => f.label === "Another Font.otf")).toBe(true);
  });

  it("returns undefined for an id that was never uploaded", () => {
    expect(getUploadedFont("upload:does-not-exist")).toBeUndefined();
  });
});
