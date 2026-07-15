"use client";
// Shared pdfjs loader for anything that rasterises a merge PDF onto a canvas
// (MergePreview's live preview, design preset thumbnails). Loaded and
// configured once at module scope so every consumer shares the same worker
// setup instead of re-resolving it per call site.

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}
