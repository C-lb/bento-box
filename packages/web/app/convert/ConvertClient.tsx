"use client";
import { useMemo, useRef, useState } from "react";
import { Download, Loader2, UploadCloud } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { defaultNameFromSource } from "@event-editor/core/convert";
import { categoryForFile, outputsFor, inputExtensions, type OutputFormat } from "@event-editor/core/convert-formats";
import { PastRuns } from "@/components/PastRuns";
import { runFileUrl } from "@/lib/past-runs";
import { uploadWithProgress } from "@/lib/upload";

interface Result { id: string; filename: string; ext?: string }

const ACCEPT = inputExtensions().map((e) => `.${e}`).join(",");

// Shared 413/401 handling for the tool's POST endpoints: 401 bounces to login,
// 413 surfaces the server's own message instead of a generic failure.
async function readJsonOrThrow(res: { ok: boolean; status: number; json: () => Promise<any> }) {
  if (res.status === 401) { window.location.assign("/login"); throw new Error("Signed out."); }
  const data = await res.json().catch(() => null);
  if (res.status === 413) throw new Error(data?.error ?? "File is too large.");
  return data;
}

export function ConvertClient() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [filename, setFilename] = useState("");
  const [edited, setEdited] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [fileName, setFileName] = useState("");
  const [output, setOutput] = useState<OutputFormat>("png");
  const [lossless, setLossless] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const [driveSaving, setDriveSaving] = useState(false);
  const [driveUrl, setDriveUrl] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  const category = useMemo(() => (fileName ? categoryForFile(fileName) : null), [fileName]);
  const outputOptions = useMemo(() => (category ? outputsFor(category) : []), [category]);
  const unsupported = hasFile && !category;

  function onPickFile() {
    const f = fileRef.current?.files?.[0];
    setHasFile(!!f);
    setFileName(f?.name ?? "");
    if (f && !edited) setFilename(defaultNameFromSource(f.name));
    if (f) {
      const cat = categoryForFile(f.name);
      if (cat) setOutput(outputsFor(cat)[0]);
    }
  }

  const canConvert = !busy && hasFile && !unsupported;

  async function convert() {
    setError(null);
    setResult(null);
    setDriveUrl(null);
    setDriveError(null);
    setBusy(true);
    setProgress(0);
    try {
      const f = fileRef.current?.files?.[0];
      if (!f) { setError("Choose a file first."); setBusy(false); return; }
      const fd = new FormData();
      fd.append("file", f);
      fd.append("filename", filename);
      fd.set("output", output);
      if (output === "webp" && lossless) fd.set("lossless", "true");
      const r = await uploadWithProgress("/api/convert/file", fd, setProgress);
      const data = await readJsonOrThrow(r);
      if (!r.ok || !data?.id) throw new Error(data?.error ?? "Conversion failed");
      setResult({ id: data.id, filename: data.filename ?? filename, ext: data.ext });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Reuses the slicer's Google Picker mechanism (token endpoint + gapi loader),
  // configured to select a folder so drive-save gets a folderId.
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

  async function saveToDrive() {
    if (!result) return;
    setDriveError(null);
    try {
      const r = await fetch("/api/drive/token");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not open the Drive picker");
      await loadGapiPicker();
      const w = window as any;
      const view = new w.google.picker.DocsView(w.google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setMimeTypes("application/vnd.google-apps.folder");
      const builder = new w.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.access_token);
      if (data.apiKey) builder.setDeveloperKey(data.apiKey);
      if (data.appId) builder.setAppId(data.appId);
      const picker = builder
        .setCallback((res: any) => {
          if (res.action === w.google.picker.Action.PICKED) {
            const folderId = res.docs?.[0]?.id;
            if (folderId) uploadToFolder(folderId);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : String(e));
    }
  }

  async function uploadToFolder(folderId: string) {
    if (!result) return;
    setDriveError(null);
    setDriveUrl(null);
    setDriveSaving(true);
    try {
      const r = await fetch("/api/convert/drive-save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: result.id, filename: result.filename, folderId, ext: result.ext ?? "mp3" }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.url) throw new Error(data?.error ?? "Drive save failed");
      setDriveUrl(data.url);
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDriveSaving(false);
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <p className="text-sm text-muted">
          Images ↔ PDF · HEIC → PNG or JPG · PDF → images · audio and video files → MP3, WAV, or M4A
        </p>

        <div className="mt-4">
          <label className="block text-sm font-medium">File
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={onPickFile}
              className="field mt-1 min-h-[44px] sm:min-h-0 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
            />
          </label>
          {hasFile && !unsupported && (
            <div className="mt-4">
              <label className="block text-sm font-medium">Output format</label>
              <div className="mt-1">
                <Segmented
                  options={outputOptions.map((o) => ({ value: o, label: o.toUpperCase() }))}
                  value={output}
                  onChange={(v) => setOutput(v as OutputFormat)}
                />
              </div>
              {output === "webp" && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={lossless}
                    onChange={(e) => setLossless(e.target.checked)}
                  />
                  <span>Lossless</span>
                  <span className="text-muted">exact quality, larger file</span>
                </label>
              )}
            </div>
          )}
          {unsupported && (
            <p className="mt-3 text-sm text-muted">This file type isn&apos;t supported yet.</p>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium">Filename
            <div className="mt-1 flex items-center gap-2">
              <input
                className="field"
                placeholder="file"
                value={filename}
                onChange={(e) => { setFilename(e.target.value); setEdited(true); }}
              />
              {hasFile && !unsupported && <span className="text-sm text-muted">.{output}</span>}
            </div>
          </label>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
            onClick={convert}
            disabled={!canConvert}
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Converting…</> : "Convert"}
          </button>
          <PastRuns
            tool="convert"
            buttonLabel="See past conversions"
            panelTitle="Recent conversions"
            emptyLabel="No conversions yet."
            fileUrl={(o) => runFileUrl("convert", o)}
          />
          {busy && (
            <span className="text-sm text-muted">Uploading {Math.round(progress * 100)}%</span>
          )}
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

          <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <a
              className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
              href={`/api/convert/${result.id}?ext=${result.ext ?? "mp3"}&name=${encodeURIComponent(result.filename)}`}
              download
            >
              <Download className="w-4 h-4" strokeWidth={1.75} /> Download
            </a>
            <button
              type="button"
              className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
              onClick={saveToDrive}
              disabled={driveSaving}
            >
              {driveSaving
                ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Saving…</>
                : <><UploadCloud className="w-4 h-4" strokeWidth={1.75} /> Save to Drive</>}
            </button>
          </div>

          {driveUrl && (
            <p className="mt-3 text-sm text-success">
              Saved to Drive. <a className="underline" href={driveUrl} target="_blank" rel="noreferrer">Open the file</a>
            </p>
          )}
          {driveError && <p className="mt-3 text-sm text-danger">{driveError}</p>}
        </div>
      )}
    </div>
  );
}
