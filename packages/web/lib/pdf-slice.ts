import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PlannedGroup } from "@event-editor/core/slice-plan";
import { swapExt } from "@event-editor/core/names";
import { renderPdfPages } from "@/lib/convert-file";
import { pagesToHtml } from "@/lib/pdf-to-html";

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

export interface StampOpts { rotationDeg?: number; sizeScale?: number; opacity?: number }

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Fill in defaults (45deg / 1x / 0.22) and clamp to safe ranges. */
export function clampStampOpts(opts?: StampOpts): { rotationDeg: number; sizeScale: number; opacity: number } {
  return {
    rotationDeg: clamp(opts?.rotationDeg ?? 45, -90, 90),
    sizeScale: clamp(opts?.sizeScale ?? 1, 0.5, 1.5),
    opacity: clamp(opts?.opacity ?? 0.22, 0.05, 0.6),
  };
}

/** Stamp a large diagonal, semi-transparent grey watermark on every page. */
export async function watermarkPdf(bytes: Uint8Array, text: string, opts?: StampOpts): Promise<Uint8Array> {
  const { rotationDeg, sizeScale, opacity } = clampStampOpts(opts);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = text.trim() || "CONFIDENTIAL";
  const angle = (rotationDeg * Math.PI) / 180;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    // Scale the font so the stamp runs most of the way across the page diagonal.
    const target = Math.hypot(width, height) * 0.9 * sizeScale;
    const probe = font.widthOfTextAtSize(label, 100);
    const size = (100 * target) / probe;
    const textWidth = font.widthOfTextAtSize(label, size);
    const x = width / 2 - (Math.cos(angle) * textWidth) / 2;
    const y = height / 2 - (Math.sin(angle) * textWidth) / 2;
    page.drawText(label, { x, y, size, font, color: rgb(0.6, 0.6, 0.6), rotate: degrees(rotationDeg), opacity });
  }
  return doc.save();
}

/** Build one PDF (or HTML) per planned group, watermarking when confidential. */
export async function buildOutputs(
  masterBytes: Uint8Array,
  groups: PlannedGroup[],
  opts: { confidential: boolean; watermarkText: string; format?: "pdf" | "html" } & StampOpts,
): Promise<OutputFile[]> {
  const format = opts.format ?? "pdf";
  const out: OutputFile[] = [];
  for (const g of groups) {
    let bytes = await extractPages(masterBytes, g.pages);
    if (opts.confidential) {
      bytes = await watermarkPdf(bytes, opts.watermarkText, {
        rotationDeg: opts.rotationDeg, sizeScale: opts.sizeScale, opacity: opts.opacity,
      });
    }
    if (format === "html") {
      const pages = await renderPdfPages(Buffer.from(bytes));
      const html = pagesToHtml(pages, g.label);
      out.push({ label: g.label, filename: swapExt(g.filename, "html"), bytes: html });
      continue;
    }
    out.push({ label: g.label, filename: g.filename, bytes });
  }
  return out;
}
