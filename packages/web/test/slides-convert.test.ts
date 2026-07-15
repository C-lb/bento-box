import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, writeFile, truncate, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SLIDES_IMPORT_MAX,
  SLIDES_MIME,
  PPTX_MIME,
  SLIDES_MSG,
  slidesCreateParams,
  slidesExportUrl,
  classifySlidesError,
  isExportSizeLimit,
  converterPlan,
  convertViaGoogleSlides,
} from "../lib/slides-convert.js";

const fakeDb = {} as any;

function fakeDrive(overrides: Partial<Record<"create" | "export" | "delete", any>> = {}) {
  return {
    files: {
      create: overrides.create ?? vi.fn(async () => ({ data: { id: "TMP1" } })),
      export: overrides.export ?? vi.fn(async () => ({ data: new TextEncoder().encode("%PDF").buffer })),
      delete: overrides.delete ?? vi.fn(async () => ({})),
    },
  } as any;
}

async function tmpPptx(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "ee-slides-test-"));
  const path = join(dir, "deck.pptx");
  await writeFile(path, "not really a pptx");
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slidesCreateParams", () => {
  it("names the file and requests Slides import via the mimeType mismatch", () => {
    const p = slidesCreateParams("deck.pptx");
    expect(p.requestBody).toEqual({ name: "deck.pptx", mimeType: SLIDES_MIME });
    expect(p.media?.mimeType).toBe(PPTX_MIME);
    expect(p.supportsAllDrives).toBe(true);
    expect(p.fields).toBe("id");
  });
});

describe("converterPlan", () => {
  it("prefers LibreOffice, falls back to Google Slides", () => {
    expect(converterPlan(true, true)).toEqual(["libreoffice", "google-slides"]);
    expect(converterPlan(true, false)).toEqual(["libreoffice"]);
    expect(converterPlan(false, true)).toEqual(["google-slides"]);
    expect(converterPlan(false, false)).toEqual([]);
  });
});

describe("classifySlidesError", () => {
  const cases: [string, unknown, string][] = [
    ["401 status", { response: { status: 401 }, message: "Unauthorized" }, "not-connected"],
    ["invalid_grant message", new Error("invalid_grant: token revoked"), "not-connected"],
    ["403 quota", { response: { status: 403 }, message: "userRateLimitExceeded" }, "unreachable"],
    ["429 rate limit", { code: 429, message: "Too many requests" }, "unreachable"],
    ["400 import failure", { response: { status: 400 }, message: "Bad import" }, "rejected"],
    ["404 gone", { code: 404, message: "File not found" }, "rejected"],
    ["500 server error", { response: { status: 500 }, message: "Backend error" }, "unreachable"],
    ["plain network error", new TypeError("fetch failed"), "unreachable"],
  ];
  it.each(cases)("%s -> %s", (_label, err, kind) => {
    expect(classifySlidesError(err).kind).toBe(kind);
    expect(classifySlidesError(err).error).toBeTruthy();
  });
});

describe("isExportSizeLimit", () => {
  it("matches the structured googleapis reason", () => {
    expect(isExportSizeLimit({ errors: [{ reason: "exportSizeLimitExceeded" }] })).toBe(true);
  });
  it("matches the reason in a plain message", () => {
    expect(isExportSizeLimit(new Error("403: exportSizeLimitExceeded"))).toBe(true);
  });
  it("rejects unrelated 403s", () => {
    expect(isExportSizeLimit({ errors: [{ reason: "userRateLimitExceeded" }] })).toBe(false);
    expect(isExportSizeLimit(new Error("quota exceeded"))).toBe(false);
  });
});

describe("convertViaGoogleSlides", () => {
  it("gates on size before uploading anything", async () => {
    const { path, cleanup } = await tmpPptx();
    await truncate(path, SLIDES_IMPORT_MAX + 1); // sparse file: logical size only
    const drive = fakeDrive();
    try {
      const out = await convertViaGoogleSlides(path, fakeDb, { drive });
      expect(out).toEqual({ ok: false, kind: "too-large", error: SLIDES_MSG.tooLarge });
      expect(drive.files.create).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("imports, exports to PDF, and deletes the temp doc", async () => {
    const { path, cleanup } = await tmpPptx();
    const drive = fakeDrive();
    try {
      const out = await convertViaGoogleSlides(path, fakeDb, { drive });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.pdf.toString()).toBe("%PDF");
      const createParams = drive.files.create.mock.calls[0][0];
      expect(createParams.requestBody).toEqual({ name: "deck.pptx", mimeType: SLIDES_MIME });
      expect(createParams.media.mimeType).toBe(PPTX_MIME);
      expect(drive.files.export).toHaveBeenCalledWith(
        { fileId: "TMP1", mimeType: "application/pdf" },
        { responseType: "arraybuffer" },
      );
      expect(drive.files.delete).toHaveBeenCalledWith({ fileId: "TMP1", supportsAllDrives: true });
    } finally {
      await cleanup();
    }
  });

  it("falls back to the export URL on exportSizeLimitExceeded", async () => {
    const { path, cleanup } = await tmpPptx();
    const drive = fakeDrive({
      export: vi.fn(async () => {
        throw { response: { status: 403 }, errors: [{ reason: "exportSizeLimitExceeded" }], message: "too big" };
      }),
    });
    const fetchMock = vi.fn(async () => new Response(Buffer.from("%PDF-big"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await convertViaGoogleSlides(path, fakeDb, { drive, accessToken: "tok123" });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.pdf.toString()).toBe("%PDF-big");
      expect(fetchMock).toHaveBeenCalledWith(slidesExportUrl("TMP1"), {
        headers: { Authorization: "Bearer tok123" },
      });
      expect(drive.files.delete).toHaveBeenCalledWith({ fileId: "TMP1", supportsAllDrives: true });
    } finally {
      await cleanup();
    }
  });

  it("does NOT hit the export URL for other export errors", async () => {
    const { path, cleanup } = await tmpPptx();
    const drive = fakeDrive({
      export: vi.fn(async () => {
        throw { response: { status: 500 }, message: "Backend error" };
      }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await convertViaGoogleSlides(path, fakeDb, { drive, accessToken: "tok123" });
      expect(out).toEqual({ ok: false, kind: "unreachable", error: SLIDES_MSG.unreachable });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("classifies a failed export-URL fetch by status", async () => {
    const { path, cleanup } = await tmpPptx();
    const drive = fakeDrive({
      export: vi.fn(async () => {
        throw { errors: [{ reason: "exportSizeLimitExceeded" }], message: "too big" };
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    try {
      const out = await convertViaGoogleSlides(path, fakeDb, { drive, accessToken: "tok123" });
      expect(out).toEqual({ ok: false, kind: "not-connected", error: SLIDES_MSG.notConnected });
      expect(drive.files.delete).toHaveBeenCalledOnce();
    } finally {
      await cleanup();
    }
  });

  it("still deletes the temp doc when export fails, and a failed delete never throws", async () => {
    const { path, cleanup } = await tmpPptx();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const drive = fakeDrive({
      export: vi.fn(async () => {
        throw { response: { status: 400 }, message: "Bad import" };
      }),
      delete: vi.fn(async () => {
        throw new Error("delete denied");
      }),
    });
    try {
      const out = await convertViaGoogleSlides(path, fakeDb, { drive });
      expect(out).toEqual({ ok: false, kind: "rejected", error: SLIDES_MSG.rejected });
      expect(drive.files.delete).toHaveBeenCalledWith({ fileId: "TMP1", supportsAllDrives: true });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await cleanup();
    }
  });

  it("reports rejected when create fails before any file exists (no delete attempted)", async () => {
    const { path, cleanup } = await tmpPptx();
    const drive = fakeDrive({
      create: vi.fn(async () => {
        throw { response: { status: 400 }, message: "Import failed" };
      }),
    });
    try {
      const out = await convertViaGoogleSlides(path, fakeDb, { drive });
      expect(out).toEqual({ ok: false, kind: "rejected", error: SLIDES_MSG.rejected });
      expect(drive.files.delete).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
