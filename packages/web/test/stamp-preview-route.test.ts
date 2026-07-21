import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";

const tmp = mkdtempSync(resolve(tmpdir(), "stamp-preview-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { GET } from "@/app/api/slice/[runId]/stamp-preview/route";
import { masterPdfPath, runDir } from "@/lib/slice";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 200]);
  return doc.save();
}

function req(runId: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://x/api/slice/${runId}/stamp-preview?${qs}`);
}

describe("stamp-preview route", () => {
  it("returns a PNG image for a valid page", async () => {
    const runId = "run1";
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(masterPdfPath(runId), Buffer.from(await makePdf(3)));
    const res = await GET(req(runId, { page: "2", text: "SECRET" }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, 30000);

  it("400s on an out-of-range page number", async () => {
    const runId = "run2";
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(masterPdfPath(runId), Buffer.from(await makePdf(2)));
    const res = await GET(req(runId, { page: "5", text: "SECRET" }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(400);
  });

  it("400s when page is missing or not a number", async () => {
    const runId = "run3";
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(masterPdfPath(runId), Buffer.from(await makePdf(2)));
    const res = await GET(req(runId, { text: "SECRET" }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(400);
  });

  it("404s when the run doesn't exist", async () => {
    const res = await GET(req("does-not-exist", { page: "1" }), { params: Promise.resolve({ runId: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });

  it("clamps wildly out-of-range cosmetic params and still returns a PNG", async () => {
    const runId = "run4";
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(masterPdfPath(runId), Buffer.from(await makePdf(3)));
    const res = await GET(
      req(runId, { page: "2", text: "SECRET", rotationDeg: "999", sizeScale: "999", opacity: "999" }),
      { params: Promise.resolve({ runId }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, 30000);
});
