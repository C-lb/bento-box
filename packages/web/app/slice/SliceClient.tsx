"use client";
import { useRef, useState } from "react";
import { Plus, X, Download, FileArchive, UploadCloud } from "lucide-react";
import { FileDrop } from "@/components/FileDrop";
import { StatusBadge } from "@/components/StatusBadge";
import { sliceStatusView } from "@/lib/status";
import type { SlideText, SpeakerGroup } from "@event-editor/core/pptx";

interface GroupRow { label: string; ranges: string }
interface OutFile { label: string; filename: string }

export function SliceClient({ hasAi }: { hasAi: boolean }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [slides, setSlides] = useState<SlideText[]>([]);

  const [mode, setMode] = useState<"manual" | "speaker">("manual");
  const [rows, setRows] = useState<GroupRow[]>([{ label: "Part 1", ranges: "" }]);

  const [confidential, setConfidential] = useState(false);
  const [watermark, setWatermark] = useState("CONFIDENTIAL");

  const [files, setFiles] = useState<OutFile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [driveFolder, setDriveFolder] = useState("");
  const [saved, setSaved] = useState<{ filename: string; url: string }[]>([]);

  const busy = ["converting", "reading", "segmenting", "exporting", "saving"].includes(status);

  async function convert() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setError("Choose a .pptx file first."); return; }
    setError(null);
    setStatus("converting");
    setFiles([]); setSaved([]); setWarnings([]);
    try {
      const r = await fetch("/api/slice/convert", { method: "POST", headers: { "x-filename": f.name }, body: f });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Conversion failed");
      setRunId(data.runId);
      setPageCount(data.pageCount);
      setSlides(data.slides);
      setRows([{ label: "Part 1", ranges: `1-${data.pageCount}` }]);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function segment() {
    if (!slides.length) return;
    setError(null);
    setStatus("segmenting");
    try {
      const r = await fetch("/api/slice/segment", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slides }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Segmentation failed");
      const groups: SpeakerGroup[] = data.groups;
      setRows(groups.map((g) => ({ label: g.speaker, ranges: g.startSlide === g.endSlide ? `${g.startSlide}` : `${g.startSlide}-${g.endSlide}` })));
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function exportPdfs() {
    if (!runId) return;
    setError(null);
    setStatus("exporting");
    setSaved([]);
    try {
      const r = await fetch("/api/slice/export", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, groups: rows, confidential, watermarkText: watermark }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Export failed");
      setFiles(data.files);
      setWarnings(data.warnings ?? []);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function saveToDrive() {
    if (!runId || !driveFolder.trim()) { setError("Enter a Drive folder id to save."); return; }
    setError(null);
    setStatus("saving");
    try {
      const r = await fetch("/api/slice/drive-save", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, folderId: driveFolder.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Drive save failed");
      setSaved(data.uploaded);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function reset() {
    setRunId(null); setPageCount(0); setSlides([]); setFiles([]); setSaved([]);
    setWarnings([]); setStatus("idle"); setError(null);
    setRows([{ label: "Part 1", ranges: "" }]);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      {/* Input */}
      <div className="card">
        <p className="eyebrow">1. Choose a deck</p>
        <div className="mt-3">
          <FileDrop inputRef={fileRef} accept=".pptx" label="Drop a .pptx here, or click to browse" />
        </div>
        <p className="mt-2 text-xs text-muted">
          Prefer Google Drive? Paste a deck file id here and it converts the same way. Drive-picker UI can come later.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn btn-accent" onClick={convert} disabled={busy}>
            {status === "converting" ? "Converting…" : "Convert to PDF"}
          </button>
          {status !== "idle" && <StatusBadge {...sliceStatusView(status)} />}
        </div>
      </div>

      {runId && (
        <>
          {/* Slicing */}
          <div className="card">
            <p className="eyebrow">2. Choose the slices</p>
            <p className="mt-1 text-sm text-muted">This deck has {pageCount} pages.</p>

            <div className="mt-3 inline-flex rounded-lg border border-line p-1">
              <button type="button" onClick={() => setMode("manual")}
                className={`rounded-md px-3 py-1.5 text-sm ${mode === "manual" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                Manual page ranges
              </button>
              <button type="button" onClick={() => setMode("speaker")}
                className={`rounded-md px-3 py-1.5 text-sm ${mode === "speaker" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                By speaker
              </button>
            </div>

            {mode === "speaker" && (
              <div className="mt-3">
                <button type="button" className="btn" onClick={segment} disabled={busy || !hasAi}>
                  {status === "segmenting" ? "Finding portions…" : "Suggest speaker portions"}
                </button>
                {!hasAi && <span className="ml-2 text-sm text-muted">Set ANTHROPIC_API_KEY to enable this.</span>}
                <p className="mt-2 text-xs text-muted">Suggestions drop into the rows below. Review and adjust before exporting.</p>
              </div>
            )}

            <div className="mt-4 space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input className="field flex-1" placeholder="Portion name" value={row.label}
                    onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, label: e.target.value } : r))} />
                  <input className="field w-40" placeholder="Pages e.g. 1-5, 8" value={row.ranges}
                    onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, ranges: e.target.value } : r))} />
                  <button type="button" className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" className="btn inline-flex items-center gap-2" onClick={() => setRows([...rows, { label: `Part ${rows.length + 1}`, ranges: "" }])}>
                <Plus className="w-4 h-4" /> Add portion
              </button>
            </div>
          </div>

          {/* Confidential */}
          <div className="card">
            <p className="eyebrow">3. Confidential watermark</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
              Stamp every page with a confidential watermark
            </label>
            {confidential && (
              <label className="mt-3 block text-sm font-medium">Watermark text
                <input className="field mt-1 w-full max-w-xs" value={watermark} onChange={(e) => setWatermark(e.target.value)} />
              </label>
            )}
          </div>

          {/* Export */}
          <div className="card">
            <p className="eyebrow">4. Export</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-accent" onClick={exportPdfs} disabled={busy}>
                {status === "exporting" ? "Building…" : "Build PDFs"}
              </button>
              <button type="button" className="btn" onClick={reset} disabled={busy}>Start over</button>
              {status !== "idle" && <StatusBadge {...sliceStatusView(status)} />}
            </div>

            {warnings.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-amber-600">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}

            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((f) => (
                  <div key={f.filename} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                    <span className="text-sm">{f.label} <span className="text-muted">({f.filename})</span></span>
                    <a className="btn inline-flex items-center gap-2" href={`/api/slice/${runId}/file/${encodeURIComponent(f.filename)}`}>
                      <Download className="w-4 h-4" /> Download
                    </a>
                  </div>
                ))}
                <a className="btn btn-accent inline-flex items-center gap-2" href={`/api/slice/${runId}/zip`}>
                  <FileArchive className="w-4 h-4" /> Download all as zip
                </a>

                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-sm font-medium">Save to Google Drive</p>
                  <p className="text-xs text-muted">Optional. Sends the output PDFs to a Drive folder.</p>
                  <div className="mt-2 flex gap-2">
                    <input className="field flex-1" placeholder="Drive folder id" value={driveFolder} onChange={(e) => setDriveFolder(e.target.value)} />
                    <button type="button" className="btn inline-flex items-center gap-2" onClick={saveToDrive} disabled={busy}>
                      <UploadCloud className="w-4 h-4" /> Save
                    </button>
                  </div>
                  {saved.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm text-success">
                      {saved.map((s) => <li key={s.filename}><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.filename}</a></li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
