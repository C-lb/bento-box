import { vi, describe, it, expect, beforeEach } from "vitest";
import { readdir, readFile as fsReadFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SLIDES_MSG } from "../lib/slides-convert.js";
import { cleanupRun, masterPdfPath } from "@/lib/slice";

// Controllable seams so tests never shell out to LibreOffice or touch Google.
const mocks = vi.hoisted(() => ({
  findSoffice: vi.fn<() => string | null>(() => "/usr/bin/soffice"),
  convertToPdf: vi.fn(async () => {}),
  readSlides: vi.fn(async () => [{ index: 1, title: "One" }]),
  getToken: vi.fn<() => unknown>(() => null),
  convertViaGoogleSlides: vi.fn(),
  pdfPageCount: vi.fn(async () => 1),
}));

vi.mock("@/lib/pptx-convert", () => ({
  findSoffice: mocks.findSoffice,
  convertToPdf: mocks.convertToPdf,
  readSlides: mocks.readSlides,
}));

vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: vi.fn(async () => null),
}));

vi.mock("@event-editor/core/tokens", () => ({
  getToken: mocks.getToken,
}));

vi.mock("@/lib/slides-convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/slides-convert.js")>()),
  convertViaGoogleSlides: mocks.convertViaGoogleSlides,
}));

vi.mock("@/lib/pdf-slice", () => ({
  pdfPageCount: mocks.pdfPageCount,
}));

// The route only uses the db for the google-token check (mocked above) and the
// best-effort history write (already wrapped in try/catch), so a stub is fine.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { POST } from "@/app/api/slice/convert/route";

async function sliceEntries(): Promise<string[]> {
  try {
    return await readdir(resolve("data/slice"));
  } catch {
    return [];
  }
}

function uploadRequest(): Request {
  return new Request("http://x/api/slice/convert", {
    method: "POST",
    headers: { "x-filename": "deck.pptx" },
    body: new Blob([new Uint8Array([1, 2, 3])]),
  });
}

beforeEach(() => {
  mocks.findSoffice.mockReturnValue("/usr/bin/soffice");
  mocks.convertToPdf.mockReset().mockResolvedValue(undefined);
  mocks.readSlides.mockReset().mockResolvedValue([{ index: 1, title: "One" }]);
  mocks.getToken.mockReset().mockReturnValue(null);
  mocks.convertViaGoogleSlides.mockReset();
  mocks.pdfPageCount.mockReset().mockResolvedValue(1);
});

describe("convert route validation ordering", () => {
  it("returns 400 and creates no run dir when driveFileId is missing", async () => {
    const before = await sliceEntries();
    const req = new Request("http://x/api/slice/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const after = await sliceEntries();
    expect(after).toEqual(before);
  });

  it("returns 400 and creates no run dir when Google is not connected", async () => {
    const before = await sliceEntries();
    const req = new Request("http://x/api/slice/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driveFileId: "abc" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const after = await sliceEntries();
    expect(after).toEqual(before);
  });
});

describe("convert route provider chain", () => {
  it("400s with the aggregate message when neither converter is available", async () => {
    mocks.findSoffice.mockReturnValue(null);
    const before = await sliceEntries();
    const res = await POST(uploadRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "Slicing needs LibreOffice or a connected Google account. Install LibreOffice, or connect Google in Settings.",
    );
    expect(mocks.convertViaGoogleSlides).not.toHaveBeenCalled();
    expect(await sliceEntries()).toEqual(before);
  });

  it("falls back to Google Slides when soffice is missing and warns about fidelity", async () => {
    mocks.findSoffice.mockReturnValue(null);
    mocks.getToken.mockReturnValue({ provider: "google", accessToken: "at" });
    mocks.convertViaGoogleSlides.mockResolvedValue({ ok: true, pdf: Buffer.from("%PDF-fake") });

    const res = await POST(uploadRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.convertToPdf).not.toHaveBeenCalled();
    expect(body.warnings).toEqual([
      "Converted with Google Slides, so layout fidelity may differ slightly.",
    ]);
    // The fallback must land the PDF exactly where the LibreOffice path would.
    expect((await fsReadFile(masterPdfPath(body.runId))).toString()).toBe("%PDF-fake");
    await cleanupRun(body.runId);
  });

  it("keeps the LibreOffice error visible when soffice failed and Google succeeded", async () => {
    mocks.convertToPdf.mockRejectedValue(new Error("soffice exploded"));
    mocks.getToken.mockReturnValue({ provider: "google", accessToken: "at" });
    mocks.convertViaGoogleSlides.mockResolvedValue({ ok: true, pdf: Buffer.from("%PDF-fake") });

    const res = await POST(uploadRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.warnings).toHaveLength(2);
    expect(body.warnings[1]).toContain("soffice exploded");
    await cleanupRun(body.runId);
  });

  it("400s with the classified Google message (plus the soffice error) when both fail, and cleans the run dir", async () => {
    mocks.convertToPdf.mockRejectedValue(new Error("soffice exploded"));
    mocks.getToken.mockReturnValue({ provider: "google", accessToken: "at" });
    mocks.convertViaGoogleSlides.mockResolvedValue({
      ok: false,
      kind: "unreachable",
      error: SLIDES_MSG.unreachable,
    });

    const before = await sliceEntries();
    const res = await POST(uploadRequest());
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain(SLIDES_MSG.unreachable);
    expect(body.error).toContain("soffice exploded");
    expect(await sliceEntries()).toEqual(before);
  });

  it("500s with the LibreOffice error when soffice fails and Google is not connected", async () => {
    mocks.convertToPdf.mockRejectedValue(new Error("soffice exploded"));
    const before = await sliceEntries();
    const res = await POST(uploadRequest());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toContain("soffice exploded");
    expect(mocks.convertViaGoogleSlides).not.toHaveBeenCalled();
    expect(await sliceEntries()).toEqual(before);
  });
});
