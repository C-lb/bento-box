"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Paintbrush, RotateCcw, X } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { applyBrush, canvasToImage, type BrushMode } from "@/lib/cutout-edit";
import { composeCutout, canvasToPngBlob, type BgFill } from "@/lib/cutout-canvas";

interface Props {
  fileName: string;
  rgb: ImageData;
  width: number;
  height: number;
  initialAlpha: Uint8ClampedArray;
  fill: BgFill;
  onCancel: () => void;
  onApply: (alpha: Uint8ClampedArray, blob: Blob) => void;
}

// The touch-up editor always shows the subject over transparency (checkerboard)
// so it's obvious what is kept vs cut, regardless of the final background fill,
// which is applied only when the edit is saved.
export function CutoutEditor({ fileName, rgb, width, height, initialAlpha, fill, onCancel, onApply }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const alphaRef = useRef<Uint8ClampedArray>(new Uint8ClampedArray(initialAlpha));
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const [mode, setMode] = useState<BrushMode>("restore");
  const [brushPct, setBrushPct] = useState(18);
  const [saving, setSaving] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number; r: number } | null>(null);

  const minDim = Math.min(width, height);
  const radiusImg = Math.max(2, Math.round((brushPct / 100) * minDim * 0.35));

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const out = new ImageData(new Uint8ClampedArray(rgb.data), width, height);
    const a = alphaRef.current;
    for (let i = 0; i < a.length; i++) out.data[i * 4 + 3] = a[i];
    ctx.putImageData(out, 0, 0);
  }, [rgb, width, height]);

  const schedulePaint = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paint();
    });
  }, [paint]);

  useEffect(() => {
    paint();
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [paint]);

  function stampAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = canvasToImage(clientX, clientY, rect, width, height);
    const prev = lastRef.current;
    if (prev) {
      // Interpolate along the drag so a fast stroke leaves no gaps.
      const dx = x - prev.x;
      const dy = y - prev.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, radiusImg / 3);
      const n = Math.floor(dist / step);
      for (let i = 1; i <= n; i++) {
        applyBrush(alphaRef.current, width, height, prev.x + (dx * i) / n, prev.y + (dy * i) / n, radiusImg, mode);
      }
    }
    applyBrush(alphaRef.current, width, height, x, y, radiusImg, mode);
    lastRef.current = { x, y };
    schedulePaint();
  }

  function updateRing(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / width;
    setRing({ x: clientX - rect.left, y: clientY - rect.top, r: radiusImg * scale });
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    lastRef.current = null;
    stampAt(e.clientX, e.clientY);
  }
  function onPointerMove(e: React.PointerEvent) {
    updateRing(e.clientX, e.clientY);
    if (drawingRef.current) stampAt(e.clientX, e.clientY);
  }
  function onPointerUp() {
    drawingRef.current = false;
    lastRef.current = null;
  }

  function reset() {
    alphaRef.current = new Uint8ClampedArray(initialAlpha);
    schedulePaint();
  }

  async function save() {
    setSaving(true);
    try {
      const canvas = composeCutout(rgb, alphaRef.current, fill);
      const blob = await canvasToPngBlob(canvas);
      onApply(new Uint8ClampedArray(alphaRef.current), blob);
    } finally {
      setSaving(false);
    }
  }

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Touch up ${fileName}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="card w-full max-w-3xl max-h-[92vh] overflow-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Touch up</p>
            <p className="mt-1 truncate text-sm font-medium">{fileName}</p>
          </div>
          <button type="button" className="btn min-h-[44px] sm:min-h-0" onClick={onCancel} aria-label="Close editor" data-tip="Close">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <p className="mt-2 text-sm text-muted">
          Restore paints the subject back in. Erase clears leftover background. Drag over the areas that need fixing.
        </p>

        <div
          className="relative mt-4 inline-block max-w-full rounded-md p-2"
          style={{
            backgroundImage: "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%)",
            backgroundSize: "16px 16px",
          }}
          onPointerLeave={() => setRing(null)}
        >
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="block max-h-[56vh] max-w-full touch-none cursor-crosshair select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {ring && (
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-full border border-black/40"
              style={{
                left: ring.x + 8,
                top: ring.y + 8,
                width: ring.r * 2,
                height: ring.r * 2,
                transform: "translate(-50%, -50%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,.5)",
              }}
            />
          )}
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Brush</p>
            <div className="mt-1">
              <Segmented
                options={[
                  { value: "restore", label: "Restore subject" },
                  { value: "erase", label: "Erase background" },
                ]}
                value={mode}
                onChange={(v) => setMode(v as BrushMode)}
              />
            </div>
          </div>

          <label className="block text-sm font-medium">
            Brush size
            <input
              type="range"
              min={3}
              max={60}
              value={brushPct}
              onChange={(e) => setBrushPct(Number(e.target.value))}
              className="mt-2 block w-full accent-accent"
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0" onClick={reset} data-tip="Undo all touch-ups">
              <RotateCcw className="w-4 h-4" strokeWidth={1.75} /> Reset
            </button>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" className="btn min-h-[44px] sm:min-h-0" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-accent inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0"
                onClick={save}
                disabled={saving}
              >
                {mode === "erase" ? <Eraser className="w-4 h-4" strokeWidth={1.75} /> : <Paintbrush className="w-4 h-4" strokeWidth={1.75} />}
                {saving ? "Saving…" : "Apply changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
