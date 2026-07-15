import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const tmp = mkdtempSync(resolve(tmpdir(), "pdfhist-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Seam-mock the pdf internals and the history helper so tests assert the
// recording contract without real PDF work or a real db.
const mocks = vi.hoisted(() => ({
  mergePdfs: vi.fn(async () => Buffer.from("%PDF-merged")),
  resavePdf: vi.fn(async () => Buffer.from("%PDF-tidied")),
  splitPdf: vi.fn(async () => [{ name: "part-1.pdf", data: Buffer.from("%PDF-part") }]),
  zipFiles: vi.fn(async () => Buffer.from("PKzip")),
  pageCount: vi.fn(async () => 3),
  createToolRun: vi.fn<(db: unknown, args: unknown) => string>(() => "run-id"),
}));

vi.mock("@/lib/pdf", () => ({
  mergePdfs: mocks.mergePdfs,
  resavePdf: mocks.resavePdf,
  splitPdf: mocks.splitPdf,
  zipFiles: mocks.zipFiles,
  pageCount: mocks.pageCount,
}));
vi.mock("@event-editor/core/tool-runs", () => ({ createToolRun: mocks.createToolRun }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { POST } from "@/app/api/pdf/process/[mode]/route";

function request(files: File[], mode: string, fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const f of files) fd.append("file", f);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const req = new Request(`http://x/api/pdf/process/${mode}`, { method: "POST", body: fd });
  return POST(req, { params: Promise.resolve({ mode }) });
}

const pdf = (name: string) => new File([Buffer.from("%PDF-1.4 fake")], name, { type: "application/pdf" });

beforeEach(() => {
  mocks.mergePdfs.mockClear().mockResolvedValue(Buffer.from("%PDF-merged"));
  mocks.resavePdf.mockClear().mockResolvedValue(Buffer.from("%PDF-tidied"));
  mocks.createToolRun.mockClear().mockReturnValue("run-id");
});

describe("pdf process route history recording", () => {
  it("records a run on merge success with mode, label, and output", async () => {
    const res = await request([pdf("a.pdf"), pdf("b.pdf")], "merge");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.createToolRun).toHaveBeenCalledTimes(1);
    expect(mocks.createToolRun.mock.calls[0][1]).toEqual({
      tool: "pdf",
      label: "a.pdf, b.pdf",
      mode: "merge",
      outputs: [{ id: body.id, filename: body.filename }],
    });
  });

  it("records a run on compress success", async () => {
    const res = await request([pdf("report.pdf")], "compress");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.createToolRun).toHaveBeenCalledTimes(1);
    expect(mocks.createToolRun.mock.calls[0][1]).toMatchObject({
      tool: "pdf",
      mode: "compress",
      outputs: [{ id: body.id, filename: "report-tidied.pdf" }],
    });
  });

  it("does not record a run when the conversion fails", async () => {
    mocks.resavePdf.mockRejectedValue(new Error("boom"));
    const res = await request([pdf("report.pdf")], "compress");
    expect(res.status).toBe(500);
    expect(mocks.createToolRun).not.toHaveBeenCalled();
  });

  it("does not record a run for an unknown mode", async () => {
    const res = await request([pdf("report.pdf")], "rotate");
    expect(res.status).toBe(400);
    expect(mocks.createToolRun).not.toHaveBeenCalled();
  });

  it("still returns the successful conversion when recording throws", async () => {
    mocks.createToolRun.mockImplementation(() => {
      throw new Error("db unavailable");
    });
    const res = await request([pdf("report.pdf")], "compress");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filename).toBe("report-tidied.pdf");
  });
});
