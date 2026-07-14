"use client";
import { useRef, useState } from "react";
import { Plus, X, Download, FileArchive, UploadCloud } from "lucide-react";
import { FileDrop } from "@/components/FileDrop";
import { StatusBadge } from "@/components/StatusBadge";
import { sliceStatusView } from "@/lib/status";
import type { SlideText, SpeakerGroup } from "@event-editor/core/pptx";
import { uploadRawWithProgress } from "@/lib/upload";

interface GroupRow { label: string; ranges: string }
interface OutFile { label: string; filename: string }

// Shared 401 handling for the tool's other POST endpoints: bounce to login
// instead of failing silently.
async function jsonOr401(r: Response) {
  if (r.status === 401) { window.location.assign("/login"); throw new Error("Signed out."); }
  return r.json();
}

export function SliceClient({ hasAi }: { hasAi: boolean }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [slides, setSlides] = useState<SlideText[]>([]);

  const [mode, setMode] = useState<"manual" | "speaker" | "topic">("manual");
  const [rows, setRows] = useState<GroupRow[]>([{ label: "Part 1", ranges: "" }]);

  const [confidential, setConfidential] = useState(false);
  const [watermark, setWatermark] = useState("CONFIDENTIAL");

  const [files, setFiles] = useState<OutFile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [driveFolder, setDriveFolder] = useState("");
  const [driveFileId, setDriveFileId] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ filename: string; url: string }[]>([]);

  const busy = ["converting", "reading", "segmenting", "exporting", "saving"].includes(status);
  const [progress, setProgress] = useState(0);

  async function convert() {
    const f = fileRef.current?.files?.[0];
    const driveId = driveFileId.trim();
    if (!f && !driveId) { setError("Drop a .pptx file or choose one from Drive first."); return; }
    setError(null);
    setStatus("converting");
    setProgress(0);
    setFiles([]); setSaved([]); setWarnings([]);
    try {
      let data: any;
      if (f) {
        const r = await uploadRawWithProgress("/api/slice/convert", f, { "x-filename": f.name }, setProgress);
        if (r.status === 401) { window.location.assign("/login"); return; }
        data = await r.json().catch(() => null);
        if (r.status === 413) throw new Error(data?.error ?? "File is too large.");
        if (!r.ok) throw new Error(data?.error ?? "Conversion failed");
      } else {
        const r = await fetch("/api/slice/convert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ driveFileId: driveId }) });
        data = await jsonOr401(r);
        if (!r.ok) throw new Error(data.error ?? "Conversion failed");
      }
      setRunId(data.runId);
      setPageCount(data.pageCount);
      setSlides(data.slides);
      setRows([{ label: "Part 1", ranges: `1-${data.pageCount}` }]);
      setWarnings(data.warnings ?? []);
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
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slides, by: mode === "topic" ? "topic" : "speaker" }),
      });
      const data = await jsonOr401(r);
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
      const data = await jsonOr401(r);
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
      const data = await jsonOr401(r);
      if (!r.ok) throw new Error(data.error ?? "Drive save failed");
      setSaved(data.uploaded);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function loadGapiPicker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = window as any;
      if (w.google?.picker) return resolve();
      const onload = () => w.gapi.load("picker", { callback: () => resolve() });
      const existing = document.getElementById("gapi-js") as HTMLScriptElement | null;
      if (existing) { onload(); return; }
      const s = document.createElement("script");
      s.id = "gapi-js";
      s.src = "https://apis.google.com/js/api.js";
      s.onload = onload;
      s.onerror = () => reject(new Error("Failed to load the Google Picker"));
      document.body.appendChild(s);
    });
  }

  async function chooseFromDrive() {
    setError(null);
    try {
      const r = await fetch("/api/drive/token");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not open the Drive picker");
      await loadGapiPicker();
      const w = window as any;
      const view = new w.google.picker.DocsView(w.google.picker.ViewId.DOCS)
        .setMimeTypes("application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint")
        .setIncludeFolders(true);
      const builder = new w.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.access_token);
      if (data.apiKey) builder.setDeveloperKey(data.apiKey);
      if (data.appId) builder.setAppId(data.appId);
      const picker = builder
        .setCallback((res: any) => {
          if (res.action === w.google.picker.Action.PICKED) {
            const doc = res.docs?.[0];
            if (doc) {
              setDriveFileId(doc.id);
              setPickedName(doc.name ?? doc.id);
            }
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function reset() {
    if (runId) {
      fetch(`/api/slice/${runId}/cleanup`, { method: "POST" }).catch(() => {});
    }
    setRunId(null); setPageCount(0); setSlides([]); setFiles([]); setSaved([]);
    setWarnings([]); setStatus("idle"); setError(null);
    setRows([{ label: "Part 1", ranges: "" }]);
    setDriveFileId(""); setPickedName(null);
    setMode("manual"); setConfidential(false); setWatermark("CONFIDENTIAL"); setDriveFolder("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      {/* Input */}
      <div className="card">
        <p className="eyebrow">1. Choose a deck</p>
        <div className="mt-3">
          <FileDrop inputRef={fileRef} accept=".pptx,.pdf" label="Drop a .pptx or .pdf here, or click to browse" />
        </div>
        <div className="mt-3">
          <button type="button" className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto" onClick={chooseFromDrive}>
            {pickedName ? "Change Drive file" : "Choose from Drive"}
          </button>
          {pickedName && <span className="ml-2 text-sm text-muted">{pickedName}</span>}
          <p className="mt-1 text-xs text-muted">Uses your connected Google account. Or drop a file above.</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted">Paste a Drive file id instead</summary>
            <input
              className="field mt-1 w-full max-w-md min-h-[44px] sm:min-h-0"
              placeholder="Drive .pptx file id"
              value={driveFileId}
              onChange={(e) => { setDriveFileId(e.target.value); setPickedName(null); }}
            />
          </details>
        </div>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
            onClick={convert}
            disabled={busy}
          >
            {status === "converting" ? "Converting…" : "Convert to PDF"}
          </button>
          {status !== "idle" && <StatusBadge {...sliceStatusView(status)} />}
        </div>
        {status === "converting" && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm text-muted">
              <span>Uploading</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-line overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {runId && (
        <>
          {/* Slicing */}
          <div className="card">
            <p className="eyebrow">2. Choose the slices</p>
            <p className="mt-1 text-sm text-muted">This deck has {pageCount} pages.</p>

            <div className="mt-3 flex flex-wrap sm:inline-flex gap-1 rounded-lg border border-line p-1">
              <button type="button" onClick={() => setMode("manual")}
                className={`min-h-[44px] sm:min-h-0 rounded-md px-3 py-1.5 text-sm ${mode === "manual" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                Manual page ranges
              </button>
              <button type="button" onClick={() => setMode("speaker")}
                className={`min-h-[44px] sm:min-h-0 rounded-md px-3 py-1.5 text-sm ${mode === "speaker" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                By speaker
              </button>
              <button type="button" onClick={() => setMode("topic")}
                className={`min-h-[44px] sm:min-h-0 rounded-md px-3 py-1.5 text-sm ${mode === "topic" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                By topic
              </button>
            </div>

            {(mode === "speaker" || mode === "topic") && (
              <div className="mt-3">
                <button type="button" className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto" onClick={segment} disabled={busy || !hasAi}>
                  {status === "segmenting"
                    ? "Finding portions…"
                    : mode === "topic"
                      ? "Suggest topic sections"
                      : "Suggest speaker portions"}
                </button>
                {!hasAi && <span className="ml-2 text-sm text-muted">Set ANTHROPIC_API_KEY to enable this.</span>}
                <p className="mt-2 text-xs text-muted">Suggestions drop into the rows below. Review and adjust before exporting.</p>
              </div>
            )}

            <div className="mt-4 space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex flex-col sm:flex-row gap-2">
                  <input className="field flex-1 min-h-[44px] sm:min-h-0" placeholder="Portion name" value={row.label}
                    onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, label: e.target.value } : r))} />
                  <input className="field sm:w-40 min-h-[44px] sm:min-h-0" placeholder="Pages e.g. 1-5, 8" value={row.ranges}
                    onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, ranges: e.target.value } : r))} />
                  <button
                    type="button"
                    className="btn min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 justify-center"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    aria-label="Remove portion"
                  >
                    <X className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
                onClick={() => setRows([...rows, { label: `Part ${rows.length + 1}`, ranges: "" }])}
              >
                <Plus className="w-4 h-4" strokeWidth={1.75} /> Add portion
              </button>
            </div>
          </div>

          {/* Confidential */}
          <div className="card">
            <p className="eyebrow">3. Confidential watermark</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} className="h-5 w-5 sm:h-4 sm:w-4" />
              Stamp every page with a confidential watermark
            </label>
            {confidential && (
              <label className="mt-3 block text-sm font-medium">Watermark text
                <input className="field mt-1 w-full max-w-xs min-h-[44px] sm:min-h-0" value={watermark} onChange={(e) => setWatermark(e.target.value)} />
              </label>
            )}
          </div>

          {/* Export */}
          <div className="card">
            <p className="eyebrow">4. Export</p>
            <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <button
                type="button"
                className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
                onClick={exportPdfs}
                disabled={busy}
              >
                {status === "exporting" ? "Building…" : "Build PDFs"}
              </button>
              <button
                type="button"
                className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
                onClick={reset}
                disabled={busy}
              >
                Start over
              </button>
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
                  <div key={f.filename} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="text-sm">{f.label} <span className="text-muted">({f.filename})</span></span>
                    <a
                      className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
                      href={`/api/slice/${runId}/file/${encodeURIComponent(f.filename)}`}
                    >
                      <Download className="w-4 h-4" strokeWidth={1.75} /> Download
                    </a>
                  </div>
                ))}
                <a
                  className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
                  href={`/api/slice/${runId}/zip`}
                >
                  <FileArchive className="w-4 h-4" strokeWidth={1.75} /> Download all as zip
                </a>

                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-sm font-medium">Save to Google Drive</p>
                  <p className="text-xs text-muted">Optional. Sends the output PDFs to a Drive folder.</p>
                  <div className="mt-2 flex flex-col sm:flex-row gap-2">
                    <input className="field flex-1 min-h-[44px] sm:min-h-0" placeholder="Drive folder id" value={driveFolder} onChange={(e) => setDriveFolder(e.target.value)} />
                    <button
                      type="button"
                      className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
                      onClick={saveToDrive}
                      disabled={busy}
                    >
                      <UploadCloud className="w-4 h-4" strokeWidth={1.75} /> Save
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
