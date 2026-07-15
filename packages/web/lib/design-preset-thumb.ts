// packages/web/lib/design-preset-thumb.ts
"use client";
import type { DocumentSpec } from "@event-editor/core/merge";
import { renderOne, type FontBytes } from "@/lib/merge-render";
import { effectiveRow } from "@/lib/design-tools";
import { loadPdfjs } from "@/lib/pdf-raster";

const THUMB_WIDTH = 256;

/**
 * Renders the current look (the client's final spec, background included) to
 * a ~256px-wide PNG data URL for the preset card preview: the same
 * renderOne -> pdfjs raster path MergePreview uses, downscaled so the string
 * stays small in localStorage. Sample/EMPTY_ROW data is fine (blank rows fall
 * back to field-name placeholders, like the live preview). Returns "" when it
 * cannot render (no DOM, raster failure) so a save never blocks on the thumb.
 */
export async function renderDesignPresetThumb(
  spec: DocumentSpec,
  row: Record<string, string>,
  fonts?: FontBytes,
): Promise<string> {
  if (typeof document === "undefined") return "";
  try {
    const [pdfjs, bytes] = await Promise.all([
      loadPdfjs(),
      renderOne(spec, effectiveRow(spec, row), fonts),
    ]);
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/png");
    } finally {
      doc.destroy();
    }
  } catch {
    return "";
  }
}
