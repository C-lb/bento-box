import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/resize", () => ({
  resizeImage: vi.fn(async (_input: Buffer) => ({ data: Buffer.from("resized"), ext: "jpg" })),
}));

vi.mock("@/lib/shorten", async () => {
  const actual = await vi.importActual<typeof import("../lib/shorten.js")>("../lib/shorten.js");
  return { ...actual };
});

describe("resizeStep adapter", () => {
  it("wraps resizeImage: reads the input file, writes the resized output, returns a FileRef", async () => {
    const { resizeStep } = await import("../lib/workflow/steps/resize.js");
    const dir = mkdtempSync(join(tmpdir(), "wf-resize-"));
    const inPath = join(dir, "photo.png");
    writeFileSync(inPath, Buffer.from("fake-png-bytes"));

    const out = await resizeStep.run(
      { path: inPath, filename: "photo.png" },
      { maxW: 800, maxH: null, format: "jpg", quality: 80 },
    );

    expect(out.filename).toMatch(/\.jpg$/);
    expect(readFileSync(out.path).toString()).toBe("resized");
  });

  it("declares file -> file kinds", async () => {
    const { resizeStep } = await import("../lib/workflow/steps/resize.js");
    expect(resizeStep.inputKind).toBe("file");
    expect(resizeStep.outputKind).toBe("file");
  });
});

describe("shortenStep adapter", () => {
  it("rejects an invalid URL by propagating the lib's validation error", async () => {
    const { shortenStep } = await import("../lib/workflow/steps/shorten.js");
    await expect(shortenStep.run({ text: "not a url" }, { service: "tinyurl" })).rejects.toThrow();
  });

  it("declares url-text -> url-text kinds", async () => {
    const { shortenStep } = await import("../lib/workflow/steps/shorten.js");
    expect(shortenStep.inputKind).toBe("url-text");
    expect(shortenStep.outputKind).toBe("url-text");
  });
});

describe("sliceStep adapter", () => {
  const { convertToPdf, readSlides, findSoffice } = vi.hoisted(() => ({
    convertToPdf: vi.fn(),
    readSlides: vi.fn(async () => [{ index: 1, text: "hi", notes: "" }]),
    findSoffice: vi.fn((): string | null => "/usr/bin/soffice"),
  }));
  const { pdfPageCount, buildOutputs } = vi.hoisted(() => ({
    pdfPageCount: vi.fn(async (_bytes: unknown) => 3),
    buildOutputs: vi.fn(async (_master: unknown, _groups: unknown, _opts: unknown) => [
      { label: "Speaker A", filename: "speaker-a.pdf", bytes: new Uint8Array([1, 2, 3]) },
    ]),
  }));
  const { visionClient, segmentSpeakers, segmentByTopic } = vi.hoisted(() => ({
    visionClient: vi.fn(() => ({})),
    segmentSpeakers: vi.fn(async () => [{ speaker: "Speaker A", startSlide: 1, endSlide: 3 }]),
    segmentByTopic: vi.fn(async () => [{ speaker: "Section A", startSlide: 1, endSlide: 3 }]),
  }));

  vi.mock("@/lib/pptx-convert", () => ({ convertToPdf, readSlides, findSoffice }));
  vi.mock("@/lib/pdf-slice", () => ({ pdfPageCount, buildOutputs }));
  vi.mock("@/lib/anthropic", () => ({ visionClient, segmentSpeakers, segmentByTopic }));

  let dataDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    findSoffice.mockReturnValue("/usr/bin/soffice");
    pdfPageCount.mockResolvedValue(3);
    buildOutputs.mockResolvedValue([
      { label: "Speaker A", filename: "speaker-a.pdf", bytes: new Uint8Array([1, 2, 3]) },
    ]);
    segmentSpeakers.mockResolvedValue([{ speaker: "Speaker A", startSlide: 1, endSlide: 3 }]);
    dataDir = mkdtempSync(join(tmpdir(), "wf-slice-data-"));
    process.env.EE_DATA_DIR = dataDir;
    // convertToPdf is mocked (no real LibreOffice call); write the dummy
    // master PDF it would normally produce so masterPdfPath() readFile succeeds.
    convertToPdf.mockImplementation(async (_pptxPath: string, outDirPath: string) => {
      writeFileSync(join(outDirPath, "deck.pdf"), Buffer.from("fake-pdf-bytes"));
      return join(outDirPath, "deck.pdf");
    });
  });

  afterEach(async () => {
    delete process.env.EE_DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("wraps convert -> segment -> export into FilesRef output (happy path, speaker mode)", async () => {
    const { sliceStep } = await import("../lib/workflow/steps/slice.js");
    const uploadDir = mkdtempSync(join(tmpdir(), "wf-slice-upload-"));
    const inPath = join(uploadDir, "my-deck.pptx");
    writeFileSync(inPath, Buffer.from("fake-pptx-bytes"));

    const out = await sliceStep.run(
      { path: inPath, filename: "my-deck.pptx" },
      { by: "speaker", confidential: false, watermarkText: "" },
    );

    expect(segmentSpeakers).toHaveBeenCalledOnce();
    expect(segmentByTopic).not.toHaveBeenCalled();
    expect(buildOutputs).toHaveBeenCalledOnce();
    // planSlices ran for real: the group's ranges ("1-3") must have resolved
    // to pages [1,2,3] before buildOutputs was called.
    const groupsArg = buildOutputs.mock.calls[0][1];
    expect(groupsArg).toEqual([{ label: "Speaker A", filename: "Speaker-A.pdf", pages: [1, 2, 3] }]);

    expect(out.files).toHaveLength(1);
    expect(out.files[0].filename).toBe("speaker-a.pdf");
    expect(readFileSync(out.files[0].path)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("declares file -> files kinds", async () => {
    const { sliceStep } = await import("../lib/workflow/steps/slice.js");
    expect(sliceStep.inputKind).toBe("file");
    expect(sliceStep.outputKind).toBe("files");
  });

  it("throws when LibreOffice is not installed", async () => {
    findSoffice.mockReturnValue(null);
    const { sliceStep } = await import("../lib/workflow/steps/slice.js");
    const uploadDir = mkdtempSync(join(tmpdir(), "wf-slice-upload-"));
    const inPath = join(uploadDir, "my-deck.pptx");
    writeFileSync(inPath, Buffer.from("fake-pptx-bytes"));
    await expect(
      sliceStep.run({ path: inPath, filename: "my-deck.pptx" }, { by: "speaker", confidential: false, watermarkText: "" }),
    ).rejects.toThrow(/LibreOffice/);
  });
});
