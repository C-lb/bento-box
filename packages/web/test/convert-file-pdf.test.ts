import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { pdfToImages, renderPdfPages } from "@/lib/convert-file";

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe("pdfToImages", () => {
  it("single page → one png (not zipped)", async () => {
    const res = await pdfToImages(await makePdf(1), "png");
    expect(res.zip).toBe(false);
    expect(res.ext).toBe("png");
    expect(res.data.length).toBeGreaterThan(0);
  }, 30000);

  it("multi page → a zip with one entry per page", async () => {
    const res = await pdfToImages(await makePdf(2), "png");
    expect(res.zip).toBe(true);
    expect(res.ext).toBe("zip");
    const zip = await JSZip.loadAsync(res.data);
    expect(Object.keys(zip.files).length).toBe(2);
  }, 30000);
});

describe("renderPdfPages", () => {
  it("returns one PNG buffer per page, in order", async () => {
    const pages = await renderPdfPages(await makePdf(3));
    expect(pages.length).toBe(3);
    for (const p of pages) {
      expect(p.length).toBeGreaterThan(0);
      // PNG signature
      expect(p.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  }, 30000);
});
