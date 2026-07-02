import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PlannedGroup } from "@event-editor/core/slice-plan";

export interface OutputFile { label: string; filename: string; bytes: Uint8Array }

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/** Copy the given 1-based pages (in the given order) into a new PDF. */
export async function extractPages(masterBytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(masterBytes);
  const total = src.getPageCount();
  const idxs = pages.map((p) => p - 1).filter((i) => i >= 0 && i < total);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, idxs);
  copied.forEach((pg) => out.addPage(pg));
  return out.save();
}

/** Stamp a large diagonal, semi-transparent grey watermark on every page. */
export async function watermarkPdf(bytes: Uint8Array, text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = text.trim() || "CONFIDENTIAL";
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) * 0.16;
    const textWidth = font.widthOfTextAtSize(label, size);
    const angle = Math.PI / 4; // 45 degrees
    // Center the rotated string roughly on the page middle.
    const x = width / 2 - (Math.cos(angle) * textWidth) / 2;
    const y = height / 2 - (Math.sin(angle) * textWidth) / 2;
    page.drawText(label, {
      x,
      y,
      size,
      font,
      color: rgb(0.6, 0.6, 0.6),
      rotate: degrees(45),
      opacity: 0.25,
    });
  }
  return doc.save();
}

/** Build one PDF per planned group, watermarking when confidential. */
export async function buildOutputs(
  masterBytes: Uint8Array,
  groups: PlannedGroup[],
  opts: { confidential: boolean; watermarkText: string },
): Promise<OutputFile[]> {
  const out: OutputFile[] = [];
  for (const g of groups) {
    let bytes = await extractPages(masterBytes, g.pages);
    if (opts.confidential) bytes = await watermarkPdf(bytes, opts.watermarkText);
    out.push({ label: g.label, filename: g.filename, bytes });
  }
  return out;
}
