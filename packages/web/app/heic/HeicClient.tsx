"use client";
import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Segmented } from "@/components/Segmented";

type Status = "idle" | "busy" | "done" | "error";

interface Row {
  key: string;
  file: File;
  name: string;
  status: Status;
  id?: string;
  filename?: string;
  error?: string;
}

export function HeicClient() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const [quality, setQuality] = useState(82);
  const [rows, setRows] = useState<Row[]>([]);

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

  async function convertRow(key: string) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, status: "busy", error: undefined } : r)));
    try {
      const fd = new FormData();
      fd.append("file", row.file);
      fd.append("format", format);
      fd.append("quality", String(quality));
      const r = await fetch("/api/heic", { method: "POST", body: fd });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.id) throw new Error(data?.error ?? "Conversion failed");
      setRows((prev) =>
        prev.map((row) =>
          row.key === key ? { ...row, status: "done", id: data.id, filename: data.filename } : row,
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, status: "error", error: message } : row)));
    }
  }

  async function convertAll() {
    for (const row of rows) {
      if (row.status === "done") continue;
      await convertRow(row.key);
    }
  }

  const anyBusy = rows.some((r) => r.status === "busy");
  const canConvert = rows.length > 0 && !anyBusy;

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <label className="block text-sm font-medium">Photos
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".heic,.heif,image/heic,image/heif"
            onChange={onPickFiles}
            className="field mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
          />
        </label>
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
            <label className="block text-sm font-medium">Quality: {quality}
              <input
                type="range"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="mt-1 w-full"
              />
            </label>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn btn-accent" onClick={convertAll} disabled={!canConvert}>
            {anyBusy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Converting…</> : "Convert all"}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card space-y-3">
          <p className="eyebrow">Files</p>
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center gap-3">
              <span className="text-sm flex-1 min-w-0 truncate">{row.name}</span>

              {row.status === "busy" && (
                <span className="inline-flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Converting…
                </span>
              )}

              {row.status === "done" && row.id && (
                <a
                  className="btn inline-flex items-center gap-2"
                  href={`/api/heic/${row.id}?name=${encodeURIComponent(row.filename ?? row.name)}&format=${format}`}
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
                    className="btn"
                    onClick={() => convertRow(row.key)}
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
