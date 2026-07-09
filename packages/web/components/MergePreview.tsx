"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { deriveFields, type DocumentSpec } from "@event-editor/core/merge";
import { renderOne, type FontBytes } from "@/lib/merge-render";

const DEBOUNCE_MS = 300;

// Loaded and configured once (module scope) so every MergePreview instance
// shares the same worker setup instead of re-resolving it per mount.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs() {
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

interface MergePreviewProps {
  spec: DocumentSpec;
  row: Record<string, string>;
  fonts?: FontBytes;
  className?: string;
}

/**
 * When no list is loaded (`row` missing or every value blank), preview with a
 * placeholder row built from the spec's own fields, each mapped to its own
 * name, so `{Name}` renders as "Name" instead of vanishing.
 */
function effectiveRow(spec: DocumentSpec, row: Record<string, string> | undefined): Record<string, string> {
  if (row && Object.values(row).some((v) => v != null && String(v).trim() !== "")) return row;
  return Object.fromEntries(deriveFields(spec).map((f) => [f, f]));
}

/**
 * Live WYSIWYG preview: renders the real merge PDF for one row and rasterises
 * page 1 onto a canvas. Because the preview *is* the PDF there's no separate
 * layout math to keep in sync with the renderer.
 */
export function MergePreview({ spec, row, fonts, className }: MergePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null);
  // Guards the whole spec/row/fonts -> PDF -> raster pipeline: a pass only
  // commits state/paints the canvas if it's still the most recently started one.
  const genTokenRef = useRef(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rasterizeCurrentDoc(myToken: number) {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;

    const page = await doc.getPage(1);
    if (myToken !== genTokenRef.current) return;

    const cssWidth = Math.max(container.clientWidth, 1);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = (cssWidth * dpr) / baseViewport.width;
    const viewport = page.getViewport({ scale });

    // Cancel any in-flight raster so it can never paint over this one.
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* already settled */ }
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (e) {
      // A cancelled render rejects by design; anything else is a real error.
      const name = e instanceof Error ? e.name : "";
      if (name !== "RenderingCancelledException") throw e;
      return;
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null;
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const myToken = ++genTokenRef.current;
      setBusy(true);
      setError(null);
      try {
        const [pdfjs, bytes] = await Promise.all([
          loadPdfjs(),
          renderOne(spec, effectiveRow(spec, row), fonts),
        ]);
        if (myToken !== genTokenRef.current) return;

        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (myToken !== genTokenRef.current) { doc.destroy(); return; }

        const prevDoc = pdfDocRef.current;
        pdfDocRef.current = doc;
        await rasterizeCurrentDoc(myToken);
        if (prevDoc && prevDoc !== doc) prevDoc.destroy();
      } catch (e) {
        if (myToken === genTokenRef.current) {
          setError(e instanceof Error ? e.message : "Could not render the preview.");
        }
      } finally {
        if (myToken === genTokenRef.current) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, row, fonts]);

  // Re-rasterise the already-rendered PDF (no re-render of the PDF itself)
  // whenever the container is resized, so the preview stays crisp.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // A resize racing a document supersede/destroy can reject; that's not
      // an error worth surfacing (the newer pass repaints anyway), and it must
      // never become an unhandled rejection.
      rasterizeCurrentDoc(genTokenRef.current).catch(() => {});
    });
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    genTokenRef.current += 1; // invalidate any in-flight pass on unmount
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch { /* noop */ } }
    if (pdfDocRef.current) pdfDocRef.current.destroy();
  }, []);

  const aspectRatio = `${spec.page.width} / ${spec.page.height}`;

  return (
    <div
      ref={containerRef}
      className={`relative w-full max-w-full overflow-hidden rounded-card border border-line bg-white shadow-soft ${className ?? ""}`}
      style={{ aspectRatio }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Loader2 className="h-5 w-5 animate-spin text-muted" strokeWidth={1.75} />
        </div>
      )}
      {error && !busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-3 text-center text-sm text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
