import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfPageCount, extractPages, watermarkPdf, buildOutputs } from "../lib/pdf-slice";

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([300, 200]);
  return doc.save();
}

describe("pdf-slice", () => {
  it("reports page count", async () => {
    expect(await pdfPageCount(await makePdf(4))).toBe(4);
  });

  it("extracts the requested 1-based pages in order", async () => {
    const out = await extractPages(await makePdf(5), [2, 4]);
    expect(await pdfPageCount(out)).toBe(2);
  });

  it("keeps page count when watermarking", async () => {
    const out = await watermarkPdf(await makePdf(3), "CONFIDENTIAL");
    expect(await pdfPageCount(out)).toBe(3);
  });

  it("builds one output per group and watermarks only when confidential", async () => {
    const master = await makePdf(6);
    const groups = [
      { label: "Intro", filename: "Intro.pdf", pages: [1, 2] },
      { label: "Q&A", filename: "QA.pdf", pages: [5, 6] },
    ];
    const plain = await buildOutputs(master, groups, { confidential: false, watermarkText: "CONFIDENTIAL" });
    expect(plain.map((f) => f.filename)).toEqual(["Intro.pdf", "QA.pdf"]);
    expect(await pdfPageCount(plain[0].bytes)).toBe(2);

    const marked = await buildOutputs(master, groups, { confidential: true, watermarkText: "SECRET" });
    // Watermarked output is a valid 2-page PDF and is larger than the plain one (extra text object).
    expect(await pdfPageCount(marked[0].bytes)).toBe(2);
    expect(marked[0].bytes.byteLength).toBeGreaterThan(plain[0].bytes.byteLength);
  });
});
