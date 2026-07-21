import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfPageCount, extractPages, watermarkPdf, buildOutputs, clampStampOpts } from "../lib/pdf-slice";

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

  it("builds HTML output per group when format is html", async () => {
    const master = await makePdf(4);
    const groups = [{ label: "Intro", filename: "Intro.pdf", pages: [1, 2] }];
    const out = await buildOutputs(master, groups, { confidential: false, watermarkText: "CONFIDENTIAL", format: "html" });
    expect(out[0].filename).toBe("Intro.html");
    const html = Buffer.from(out[0].bytes).toString("utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(2);
  }, 30000);

  it("defaults to pdf format when format is omitted", async () => {
    const master = await makePdf(2);
    const groups = [{ label: "Intro", filename: "Intro.pdf", pages: [1] }];
    const out = await buildOutputs(master, groups, { confidential: false, watermarkText: "CONFIDENTIAL" });
    expect(out[0].filename).toBe("Intro.pdf");
  });

  it("clamps stamp options to safe ranges and fills in defaults", () => {
    expect(clampStampOpts()).toEqual({ rotationDeg: 45, sizeScale: 1, opacity: 0.22 });
    expect(clampStampOpts({ rotationDeg: 999, sizeScale: 999, opacity: 999 })).toEqual({ rotationDeg: 90, sizeScale: 1.5, opacity: 0.6 });
    expect(clampStampOpts({ rotationDeg: -999, sizeScale: -999, opacity: -999 })).toEqual({ rotationDeg: -90, sizeScale: 0.5, opacity: 0.05 });
    expect(clampStampOpts({ rotationDeg: 10, sizeScale: 0.8, opacity: 0.4 })).toEqual({ rotationDeg: 10, sizeScale: 0.8, opacity: 0.4 });
  });

  it("watermarkPdf accepts custom rotation/size/opacity and stays a valid PDF", async () => {
    const out = await watermarkPdf(await makePdf(2), "SECRET", { rotationDeg: 10, sizeScale: 0.6, opacity: 0.5 });
    expect(await pdfPageCount(out)).toBe(2);
  });

  it("watermarkPdf with no opts matches the default-opts stamp exactly", async () => {
    const src = await makePdf(1);
    const a = await watermarkPdf(src, "SECRET");
    const b = await watermarkPdf(src, "SECRET", { rotationDeg: 45, sizeScale: 1, opacity: 0.22 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("buildOutputs passes stamp options through to watermarkPdf", async () => {
    const master = await makePdf(2);
    const groups = [{ label: "Intro", filename: "Intro.pdf", pages: [1, 2] }];
    const custom = await buildOutputs(master, groups, {
      confidential: true, watermarkText: "SECRET", rotationDeg: 0, sizeScale: 0.5, opacity: 0.6,
    });
    const defaultOpts = await buildOutputs(master, groups, { confidential: true, watermarkText: "SECRET" });
    // Different stamp geometry/opacity produce different bytes for the same page count.
    expect(await pdfPageCount(custom[0].bytes)).toBe(2);
    expect(Buffer.from(custom[0].bytes).equals(Buffer.from(defaultOpts[0].bytes))).toBe(false);
  });
});
