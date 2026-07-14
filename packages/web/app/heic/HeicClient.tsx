"use client";
import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { FileDrop } from "@/components/FileDrop";
import { SnapSlider } from "@/components/SnapSlider";
import { PastHeic } from "./PastHeic";
import { uploadWithProgress } from "@/lib/upload";

type Status = "idle" | "busy" | "done" | "error";

interface Row {
  key: string;
  file: File;
  name: string;
  status: Status;
  progress?: number;
  id?: string;
  filename?: string;
  outFormat?: "jpg" | "png";
  error?: string;
}

// 401 bounces to login, 413 surfaces the server's own message.
async function readJsonOrThrow(res: { status: number; json: () => Promise<any> }) {
  if (res.status === 401) { window.location.assign("/login"); throw new Error("Signed out."); }
  const data = await res.json().catch(() => null);
  if (res.status === 413) throw new Error(data?.error ?? "File is too large.");
  return data;
}

export function HeicClient() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const [quality, setQuality] = useState(82);
  const [saturation, setSaturation] = useState(1);
  const [brightness, setBrightness] = useState(1);
  const [haze, setHaze] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);

  const filtersActive = saturation !== 1 || brightness !== 1 || haze > 0;
  function resetFilters() { setSaturation(1); setBrightness(1); setHaze(0); }

  function onPickFiles() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    const next: Row[] = Array.from(files).map((f, i) => ({
      key: `${Date.now()}-${i}-${f.name}`,
      file: f,
      name: f.name,
      status: "idle",
    }));
    setRows(next);
  }

  async function convertRow(key: string, batchId: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, status: "busy", progress: 0, error: undefined } : r)));
    try {
      const fd = new FormData();
      fd.append("file", row.file);
      fd.append("batchId", batchId);
      fd.append("format", format);
      fd.append("quality", String(quality));
      fd.append("saturation", String(saturation));
      fd.append("brightness", String(brightness));
      fd.append("haze", String(haze));
      const r = await uploadWithProgress("/api/heic", fd, (p) =>
        setRows((prev) => prev.map((row) => (row.key === key ? { ...row, progress: p } : row))),
      );
      const data = await readJsonOrThrow(r);
      if (!r.ok || !data?.id) throw new Error(data?.error ?? "Conversion failed");
      setRows((prev) =>
        prev.map((row) =>
          row.key === key
            ? { ...row, status: "done", id: data.id, filename: data.filename, outFormat: data.format }
            : row,
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, status: "error", error: message } : row)));
    }
  }

  async function convertAll() {
    // One batch id for the whole run, so history bundles these files together.
    const batchId = crypto.randomUUID();
    for (const row of rows) {
      if (row.status === "done") continue;
      await convertRow(row.key, batchId);
    }
  }

  const anyBusy = rows.some((r) => r.status === "busy");
  const canConvert = rows.length > 0 && !anyBusy;

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <p className="text-sm font-medium">Photos</p>
        <div className="mt-1">
          <FileDrop inputRef={fileRef} accept=".heic,.heif,image/heic,image/heif" multiple onChange={onPickFiles} label="Drop HEIC photos here, or click to browse" />
        </div>
        <p className="mt-1 text-sm text-muted">Pick one or more HEIC or HEIF photos.</p>

        <div className="mt-4">
          <p className="text-sm font-medium">Format</p>
          <div className="mt-1">
            <Segmented
              options={[{ value: "jpg", label: "jpg" }, { value: "png", label: "png" }]}
              value={format}
              onChange={(v) => setFormat(v as "jpg" | "png")}
            />
          </div>
        </div>

        {format === "jpg" && (
          <div className="mt-4">
            <SnapSlider
              label="Quality"
              value={quality}
              onChange={setQuality}
              min={1}
              max={100}
              checkpoints={[25, 50, 75, 100]}
              format={(v) => `${v}`}
            />
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Filters</p>
            {filtersActive && (
              <button type="button" className="text-sm text-muted hover:text-ink" onClick={resetFilters}>Reset</button>
            )}
          </div>
          <div className="mt-3 space-y-4">
            <SnapSlider
              label="Saturation"
              value={saturation}
              onChange={setSaturation}
              min={0}
              max={2}
              step={0.05}
              checkpoints={[0, 1, 2]}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SnapSlider
              label="Brightness"
              value={brightness}
              onChange={setBrightness}
              min={0}
              max={2}
              step={0.05}
              checkpoints={[0.5, 1, 1.5]}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SnapSlider
              label="Haze"
              value={haze}
              onChange={setHaze}
              min={0}
              max={20}
              step={0.5}
              checkpoints={[0, 5, 10, 20]}
              format={(v) => (v === 0 ? "off" : `${v}`)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button type="button" className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={convertAll} disabled={!canConvert}>
            {anyBusy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Converting…</> : "Convert all"}
          </button>
          <PastHeic />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card space-y-3">
          <p className="eyebrow">Files</p>
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center gap-3">
              <span className="text-sm flex-1 min-w-0 truncate">{row.name}</span>

              {row.status === "busy" && (
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <span className="inline-flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Converting… {Math.round((row.progress ?? 0) * 100)}%
                  </span>
                  <div className="ml-auto h-1.5 w-24 shrink-0 rounded-full bg-line overflow-hidden sm:ml-0">
                    <div className="h-1.5 rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((row.progress ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}

              {row.status === "done" && row.id && (
                <a
                  className="btn inline-flex items-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
                  href={`/api/heic/${row.id}?name=${encodeURIComponent(row.filename ?? row.name)}&format=${row.outFormat ?? "jpg"}`}
                  download
                >
                  <Download className="w-4 h-4" strokeWidth={1.75} /> Download
                </a>
              )}

              {row.status === "error" && (
                <>
                  <span className="text-sm text-danger">{row.error}</span>
                  <button
                    type="button"
                    className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
                    onClick={() => convertRow(row.key, crypto.randomUUID())}
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
