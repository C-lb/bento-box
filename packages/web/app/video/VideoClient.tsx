"use client";
import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { FileDrop } from "@/components/FileDrop";
import { PastRuns } from "@/components/PastRuns";
import { runFileUrl } from "@/lib/past-runs";
import { uploadWithProgress } from "@/lib/upload";

interface Result { id: string; filename: string; bytesIn: number; bytesOut: number }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function VideoClient() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [preset, setPreset] = useState<"smaller" | "balanced" | "quality">("balanced");
  const [scale, setScale] = useState<"keep" | "1080" | "720">("keep");
  const [hasFile, setHasFile] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function onPickFile() {
    setHasFile(!!fileRef.current?.files?.[0]);
    setResult(null);
    setError(null);
  }

  const canCompress = !busy && hasFile;

  async function compress() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setError("Choose a video first."); return; }
    setError(null);
    setResult(null);
    setBusy(true);
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("preset", preset);
      fd.append("scale", scale);
      const r = await uploadWithProgress("/api/video", fd, setProgress);
      if (r.status === 401) { window.location.assign("/login"); return; }
      const data: any = await r.json().catch(() => null);
      if (r.status === 413) throw new Error(data?.error ?? "File is too large.");
      if (!r.ok || !data?.id) throw new Error(data?.error ?? "Compression failed");
      setResult({ id: data.id, filename: data.filename, bytesIn: data.bytesIn, bytesOut: data.bytesOut });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <p className="text-sm font-medium">Video</p>
        <div className="mt-1">
          <FileDrop inputRef={fileRef} accept="video/*" onChange={onPickFile} label="Drop a video here, or click to browse" />
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium">Preset</p>
          <div className="mt-1">
            <Segmented
              options={[
                { value: "smaller", label: "Smaller" },
                { value: "balanced", label: "Balanced" },
                { value: "quality", label: "Best quality" },
              ]}
              value={preset}
              onChange={(v) => setPreset(v as "smaller" | "balanced" | "quality")}
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium">Scale</p>
          <div className="mt-1">
            <Segmented
              options={[
                { value: "keep", label: "Keep" },
                { value: "1080", label: "1080p" },
                { value: "720", label: "720p" },
              ]}
              value={scale}
              onChange={(v) => setScale(v as "keep" | "1080" | "720")}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
            onClick={compress}
            disabled={!canCompress}
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Compressing…</> : "Compress"}
          </button>
          <PastRuns
            tool="video"
            buttonLabel="See past compressions"
            panelTitle="Recent compressions"
            emptyLabel="No compressions yet."
            fileUrl={(o) => runFileUrl("video", o)}
          />
          {busy && <span className="text-sm text-muted">This can take a while for long videos.</span>}
        </div>

        {busy && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-line overflow-hidden">
            <div
              className="h-1.5 rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {result && (
        <div className="card">
          <p className="eyebrow">Ready</p>
          <p className="mt-1 text-sm">{result.filename}</p>
          <p className="mt-1 text-sm text-muted">{formatBytes(result.bytesIn)} → {formatBytes(result.bytesOut)}</p>

          <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <a
              className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
              href={`/api/video/${result.id}?name=${encodeURIComponent(result.filename)}`}
              download
            >
              <Download className="w-4 h-4" strokeWidth={1.75} /> Download
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
