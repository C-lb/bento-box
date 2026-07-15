import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TOOL_BACKGROUNDS,
  backgroundsForTool,
  backgroundThumbUrl,
  loadBackgroundById,
} from "./design-backgrounds";

function publicPath(rel: string): string {
  return fileURLToPath(new URL(`../public/${rel}`, import.meta.url));
}

describe("TOOL_BACKGROUNDS registry", () => {
  it("has unique ids", () => {
    const ids = TOOL_BACKGROUNDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers certificate and ticket with four designs each", () => {
    expect(backgroundsForTool("certificate")).toHaveLength(4);
    expect(backgroundsForTool("ticket")).toHaveLength(4);
    expect(backgroundsForTool("badge")).toEqual([]);
  });

  it("every entry's generated pdf and png thumbnail exist on disk", () => {
    for (const b of TOOL_BACKGROUNDS) {
      const pdf = publicPath(`backgrounds/${b.tool}/${b.file}`);
      const png = publicPath(`backgrounds/${b.tool}/${b.file.replace(/\.pdf$/, ".png")}`);
      expect(existsSync(pdf), `missing ${pdf}`).toBe(true);
      expect(existsSync(png), `missing ${png}`).toBe(true);
    }
  });

  it("thumbnail urls swap the pdf extension for png", () => {
    const stub = TOOL_BACKGROUNDS.find((b) => b.id === "ticket-stub")!;
    expect(backgroundThumbUrl(stub)).toBe("/backgrounds/ticket/ticket-stub.png");
  });
});

describe("loadBackgroundById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(bytes: Uint8Array) {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => bytes.buffer.slice(0),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns the assetSrc pdf convention: kind pdf, plain base64 src", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"
    stubFetch(bytes);
    const bg = await loadBackgroundById("cert-double-rule");
    expect(bg.kind).toBe("pdf");
    expect(bg.src).toBe(btoa("%PDF"));
    expect(bg.src.startsWith("data:")).toBe(false);
  });

  it("memoises per id: a second load never refetches", async () => {
    const fetchMock = stubFetch(new Uint8Array([1, 2, 3]));
    const first = await loadBackgroundById("cert-bottom-bar");
    const second = await loadBackgroundById("cert-bottom-bar");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/backgrounds/certificate/cert-bottom-bar.pdf");
  });

  it("rejects for an unknown id without fetching", async () => {
    const fetchMock = stubFetch(new Uint8Array());
    await expect(loadBackgroundById("nope")).rejects.toThrow("Unknown background id: nope");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects on a failed fetch and does not poison the cache", async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", failing);
    await expect(loadBackgroundById("ticket-top-band")).rejects.toThrow("404");
    const bytes = new Uint8Array([9]);
    const fetchMock = stubFetch(bytes);
    const bg = await loadBackgroundById("ticket-top-band");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bg.src).toBe(btoa(String.fromCharCode(9)));
  });
});
