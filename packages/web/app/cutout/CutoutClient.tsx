"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { cutoutOutName, normalizeBgFill } from "@event-editor/core/cutout";

type FillMode = "transparent" | "white" | "custom";
type Status = "idle" | "loading" | "busy" | "done" | "error";

interface Row {
  key: string;
  file: File;
  name: string;
  status: Status;
  url?: string;
  filename?: string;
  error?: string;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `cutout-${Date.now().toString(36)}-${keySeq}`;
}

export function CutoutClient() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [fill, setFill] = useState<FillMode>("transparent");
  const [customColor, setCustomColor] = useState("#ffffff");
  const [rows, setRows] = useState<Row[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segmenterRef = useRef<any>(null);

  // Keep a ref in sync with rows so unmount cleanup revokes the URLs that are
  // actually live, not the rows captured by the initial-render closure.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => () => {
    for (const r of rowsRef.current) if (r.url) URL.revokeObjectURL(r.url);
  }, []);

  function onPickFiles() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    const next: Row[] = Array.from(files).map((f, i) => ({
      key: `${nextKey()}-${i}`,
      file: f,
      name: f.name,
      status: "idle",
    }));
    setRows((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeRow(key: string) {
    setRows((prev) => {
      const row = prev.find((r) => r.key === key);
      if (row?.url) URL.revokeObjectURL(row.url);
      return prev.filter((r) => r.key !== key);
    });
  }

  async function getSegmenter() {
    if (segmenterRef.current) return segmenterRef.current;
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const seg = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/mediapipe/selfie_segmenter.tflite" },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    segmenterRef.current = seg;
    return seg;
  }

  async function runRow(key: string, fillColor: { color: string } | "transparent") {
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row) return;

    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, status: segmenterRef.current ? "busy" : "loading", error: undefined } : r)),
    );

    try {
      const seg = await getSegmenter();
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, status: "busy" } : r)));

      const bitmap = await createImageBitmap(row.file);
      const result = seg.segment(bitmap);
      try {
        const mask = result.confidenceMasks?.[0];
        if (!mask) throw new Error("No segmentation mask returned.");
        const conf = mask.getAsFloat32Array();
        const mw = mask.width;
        const mh = mask.height;
        // Always export at the input image's full resolution. MediaPipe may
        // return the confidence mask at the model's internal size (~256px), so
        // we sample the mask with nearest-neighbor scaling onto the full-res
        // pixels instead of shrinking the image down to the mask.
        const W = bitmap.width;
        const H = bitmap.height;

        const canvasA = document.createElement("canvas");
        canvasA.width = W;
        canvasA.height = H;
        const ctxA = canvasA.getContext("2d");
        if (!ctxA) throw new Error("Canvas not supported.");
        ctxA.drawImage(bitmap, 0, 0);
        const img = ctxA.getImageData(0, 0, W, H);
        for (let y = 0; y < H; y++) {
          const my = Math.floor((y * mh) / H);
          for (let x = 0; x < W; x++) {
            const mx = Math.floor((x * mw) / W);
            const a = conf[my * mw + mx];
            img.data[(y * W + x) * 4 + 3] = Math.round(a * 255);
          }
        }
        ctxA.putImageData(img, 0, 0);

        let outCanvas = canvasA;
        if (fillColor !== "transparent") {
          const canvasB = document.createElement("canvas");
          canvasB.width = W;
          canvasB.height = H;
          const ctxB = canvasB.getContext("2d");
          if (!ctxB) throw new Error("Canvas not supported.");
          ctxB.fillStyle = fillColor.color;
          ctxB.fillRect(0, 0, W, H);
          ctxB.drawImage(canvasA, 0, 0);
          outCanvas = canvasB;
        }

        const blob: Blob | null = await new Promise((resolve) => outCanvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not export the result.");
        const url = URL.createObjectURL(blob);
        setRows((prev) =>
          prev.map((r) =>
            r.key === key ? { ...r, status: "done", url, filename: cutoutOutName(row.file.name) } : r,
          ),
        );
      } finally {
        result.close();
        bitmap.close();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, status: "error", error: message } : r)));
    }
  }

  async function runAll() {
    const fillColor = normalizeBgFill({ mode: fill, color: customColor });
    for (const row of rowsRef.current) {
      if (row.status === "idle" || row.status === "error") {
        await runRow(row.key, fillColor);
      }
    }
  }

  const anyBusy = rows.some((r) => r.status === "busy" || r.status === "loading");
  const canRun = rows.some((r) => r.status === "idle" || r.status === "error") && !anyBusy;

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <label className="block text-sm font-medium">Photos
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            onChange={onPickFiles}
            className="field mt-1 min-h-[44px] sm:min-h-0 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
          />
        </label>
        <p className="mt-1 text-sm text-muted">Pick one or more photos. Best for photos of people.</p>

        <div className="mt-4">
          <p className="text-sm font-medium">Background</p>
          <div className="mt-1">
            <Segmented
              options={[
                { value: "transparent", label: "Transparent" },
                { value: "white", label: "White" },
                { value: "custom", label: "Custom colour" },
              ]}
              value={fill}
              onChange={(v) => setFill(v as FillMode)}
            />
          </div>
          {fill === "custom" && (
            <label className="mt-3 flex items-center gap-2 text-sm font-medium">
              Colour
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                className="h-8 w-12 rounded-md border-0"
              />
            </label>
          )}
        </div>

        <div className="mt-4">
          <button type="button" className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={runAll} disabled={!canRun}>
            {anyBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Removing…
              </>
            ) : (
              "Remove backgrounds"
            )}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card space-y-4">
          <p className="eyebrow">Files</p>
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm flex-1 min-w-0 truncate">{row.name}</span>
                  <button type="button" className="btn min-h-[44px] sm:min-h-0" onClick={() => removeRow(row.key)}>
                    Remove
                  </button>
                </div>

                {row.status === "loading" && (
                  <span className="inline-flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Preparing the background remover…
                  </span>
                )}

                {row.status === "busy" && (
                  <span className="inline-flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Removing…
                  </span>
                )}

                {row.status === "done" && row.url && (
                  <div className="space-y-2">
                    <div
                      className="inline-block rounded-md p-2"
                      style={{
                        backgroundImage:
                          "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%)",
                        backgroundSize: "16px 16px",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={row.url} alt={`Cutout of ${row.name}`} className="max-h-48 max-w-full" />
                    </div>
                    <div>
                      <a className="btn inline-flex items-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" href={row.url} download={row.filename}>
                        <Download className="w-4 h-4" strokeWidth={1.75} /> Download
                      </a>
                    </div>
                  </div>
                )}

                {row.status === "error" && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-danger">{row.error}</span>
                    <button
                      type="button"
                      className="btn min-h-[44px] sm:min-h-0"
                      disabled={anyBusy}
                      onClick={() => runRow(row.key, normalizeBgFill({ mode: fill, color: customColor }))}
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
