"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Wand2, Trash2 } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { cutoutOutName, normalizeBgFill } from "@event-editor/core/cutout";
import { composeCutout, canvasToPngBlob, decodeToRgb, type BgFill } from "@/lib/cutout-canvas";
import {
  addCutoutHistory,
  listCutoutHistory,
  removeCutoutHistory,
  clearCutoutHistory,
  newCutoutId,
  type CutoutHistoryItem,
} from "@/lib/cutout-history";
import { CutoutEditor } from "./CutoutEditor";

type FillMode = "transparent" | "white" | "custom";
type Status = "idle" | "loading" | "busy" | "done" | "error";

interface EditData {
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Row {
  key: string;
  file: File;
  name: string;
  status: Status;
  url?: string;
  filename?: string;
  error?: string;
  edit?: EditData;
}

interface EditorSession {
  key: string;
  fileName: string;
  rgb: ImageData;
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  fill: BgFill;
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
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const [openingEditor, setOpeningEditor] = useState<string | null>(null);

  const [history, setHistory] = useState<CutoutHistoryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segmenterRef = useRef<any>(null);

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => () => {
    for (const r of rowsRef.current) if (r.url) URL.revokeObjectURL(r.url);
  }, []);

  // Load persisted history once.
  useEffect(() => {
    let alive = true;
    listCutoutHistory().then((items) => { if (alive) setHistory(items); });
    return () => { alive = false; };
  }, []);

  // Thumbnails: one object URL per history item, revoked when the set changes.
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const it of history) map[it.id] = URL.createObjectURL(it.blob);
    setThumbs(map);
    return () => { for (const url of Object.values(map)) URL.revokeObjectURL(url); };
  }, [history]);

  async function saveToHistory(name: string, blob: Blob) {
    await addCutoutHistory({ id: newCutoutId(), name, at: Date.now(), blob });
    setHistory(await listCutoutHistory());
  }

  function currentFill(): BgFill {
    return normalizeBgFill({ mode: fill, color: customColor });
  }

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

  async function runRow(key: string, fillColor: BgFill) {
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row) return;

    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, status: segmenterRef.current ? "busy" : "loading", error: undefined } : r)),
    );

    try {
      const seg = await getSegmenter();
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, status: "busy" } : r)));

      const { rgb, W, H } = await decodeToRgb(row.file);
      const bitmap = await createImageBitmap(row.file);
      const result = seg.segment(bitmap);
      try {
        const mask = result.confidenceMasks?.[0];
        if (!mask) throw new Error("No segmentation mask returned.");
        const conf = mask.getAsFloat32Array();
        const mw = mask.width;
        const mh = mask.height;

        // Sample the (small) confidence mask onto full-res alpha, nearest-neighbor.
        const alpha = new Uint8ClampedArray(W * H);
        for (let y = 0; y < H; y++) {
          const my = Math.floor((y * mh) / H);
          for (let x = 0; x < W; x++) {
            const mx = Math.floor((x * mw) / W);
            alpha[y * W + x] = Math.round(conf[my * mw + mx] * 255);
          }
        }

        const outCanvas = composeCutout(rgb, alpha, fillColor);
        const blob = await canvasToPngBlob(outCanvas);
        const filename = cutoutOutName(row.file.name);
        const url = URL.createObjectURL(blob);
        setRows((prev) =>
          prev.map((r) =>
            r.key === key ? { ...r, status: "done", url, filename, edit: { alpha, width: W, height: H } } : r,
          ),
        );
        void saveToHistory(filename, blob);
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
    const fillColor = currentFill();
    for (const row of rowsRef.current) {
      if (row.status === "idle" || row.status === "error") {
        await runRow(row.key, fillColor);
      }
    }
  }

  async function openEditor(key: string) {
    const row = rowsRef.current.find((r) => r.key === key);
    if (!row?.edit) return;
    setOpeningEditor(key);
    try {
      const { rgb, W, H } = await decodeToRgb(row.file);
      setEditor({
        key,
        fileName: row.name,
        rgb,
        alpha: new Uint8ClampedArray(row.edit.alpha),
        width: W,
        height: H,
        fill: currentFill(),
      });
    } catch {
      // if decode fails, just leave the editor closed
    } finally {
      setOpeningEditor(null);
    }
  }

  function applyEdit(alpha: Uint8ClampedArray, blob: Blob) {
    if (!editor) return;
    const key = editor.key;
    const url = URL.createObjectURL(blob);
    let filename = "cutout.png";
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (r.url) URL.revokeObjectURL(r.url);
        filename = r.filename ?? cutoutOutName(r.name);
        return { ...r, url, edit: { alpha, width: editor.width, height: editor.height } };
      }),
    );
    void saveToHistory(filename, blob);
    setEditor(null);
  }

  async function handleRemoveHistory(id: string) {
    await removeCutoutHistory(id);
    setHistory((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleClearHistory() {
    await clearCutoutHistory();
    setHistory([]);
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
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
                        onClick={() => openEditor(row.key)}
                        disabled={openingEditor === row.key}
                        data-tip="Brush to fix edges"
                      >
                        {openingEditor === row.key ? (
                          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                        ) : (
                          <Wand2 className="w-4 h-4" strokeWidth={1.75} />
                        )}
                        Touch up
                      </button>
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
                      onClick={() => runRow(row.key, currentFill())}
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

      {history.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">See past cut-outs</p>
            <button type="button" className="btn min-h-[44px] sm:min-h-0" onClick={handleClearHistory}>
              Clear all
            </button>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {history.map((item) => (
              <li key={item.id} className="space-y-2">
                <div
                  className="rounded-md p-2"
                  style={{
                    backgroundImage: "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%)",
                    backgroundSize: "12px 12px",
                  }}
                >
                  {thumbs[item.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[item.id]} alt={item.name} className="mx-auto max-h-28 max-w-full" />
                  )}
                </div>
                <p className="truncate text-sm">{item.name}</p>
                <div className="flex gap-2">
                  {thumbs[item.id] && (
                    <a
                      className="btn inline-flex flex-1 items-center justify-center gap-2 min-h-[44px] sm:min-h-0"
                      href={thumbs[item.id]}
                      download={item.name}
                    >
                      <Download className="w-4 h-4" strokeWidth={1.75} /> Save
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn min-h-[44px] sm:min-h-0"
                    onClick={() => handleRemoveHistory(item.id)}
                    aria-label={`Remove ${item.name} from history`}
                    data-tip="Remove"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editor && (
        <CutoutEditor
          fileName={editor.fileName}
          rgb={editor.rgb}
          width={editor.width}
          height={editor.height}
          initialAlpha={editor.alpha}
          fill={editor.fill}
          onCancel={() => setEditor(null)}
          onApply={applyEdit}
        />
      )}
    </div>
  );
}
