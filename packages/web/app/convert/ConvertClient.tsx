"use client";
import { useRef, useState } from "react";
import { Download, Loader2, UploadCloud } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { defaultNameFromSource } from "@event-editor/core/convert";

interface Result { id: string; filename: string }

export function ConvertClient({ ytDlp }: { ytDlp: boolean }) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<"link" | "file">("link");
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [edited, setEdited] = useState(false);
  const [hasFile, setHasFile] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const [driveSaving, setDriveSaving] = useState(false);
  const [driveUrl, setDriveUrl] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  const isUrl = (v: string) => /^https?:\/\//i.test(v.trim());

  // Prefill the filename from the source title, but never clobber a manual edit.
  async function prefillFromUrl(value: string) {
    if (edited || !isUrl(value)) return;
    try {
      const r = await fetch("/api/convert/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value.trim() }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok && data?.title && !edited) setFilename(data.title);
    } catch { /* prefill is best-effort; leave the field as is */ }
  }

  function onPickFile() {
    const f = fileRef.current?.files?.[0];
    setHasFile(!!f);
    if (f && !edited) setFilename(defaultNameFromSource(f.name));
  }

  const canConvert = !busy && (mode === "link" ? isUrl(url) : hasFile);

  async function convert() {
    setError(null);
    setResult(null);
    setDriveUrl(null);
    setDriveError(null);
    setBusy(true);
    try {
      let r: Response;
      if (mode === "link") {
        r = await fetch("/api/convert/url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: url.trim(), filename }),
        });
      } else {
        const f = fileRef.current?.files?.[0];
        if (!f) { setError("Choose a file first."); setBusy(false); return; }
        const fd = new FormData();
        fd.append("file", f);
        fd.append("filename", filename);
        r = await fetch("/api/convert/file", { method: "POST", body: fd });
      }
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.id) throw new Error(data?.error ?? "Conversion failed");
      setResult({ id: data.id, filename: data.filename ?? filename });
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
      const picker = new w.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.access_token)
        .setDeveloperKey(data.apiKey)
        .setAppId(data.appId)
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
        body: JSON.stringify({ id: result.id, filename: result.filename, folderId }),
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
        <Segmented
          options={[{ value: "link", label: "From link" }, { value: "file", label: "Upload file" }]}
          value={mode}
          onChange={(v) => { setMode(v as "link" | "file"); setError(null); }}
        />

        {mode === "link" && (
          ytDlp ? (
            <div className="mt-4">
              <label className="block text-sm font-medium">Link
                <input
                  className="field mt-1"
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={(e) => prefillFromUrl(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text");
                    if (isUrl(pasted)) setTimeout(() => prefillFromUrl(pasted), 0);
                  }}
                />
              </label>
              <p className="mt-1 text-sm text-muted">Paste a link and we fetch the audio, then transcode it to mp3.</p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-line bg-raised px-4 py-3 shadow-raisededge">
              <p className="text-sm font-medium">Links need yt-dlp</p>
              <p className="mt-1 text-sm text-muted">
                Download yt-dlp in <a className="underline" href="/settings">settings</a> to convert from links. You can still upload a file.
              </p>
            </div>
          )
        )}

        {mode === "file" && (
          <div className="mt-4">
            <label className="block text-sm font-medium">File
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,video/*"
                onChange={onPickFile}
                className="field mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
              />
            </label>
            <p className="mt-1 text-sm text-muted">
              Supports video (mp4, mov, mkv, webm, avi, m4v) and audio (mp3, wav, m4a, aac, flac, ogg).
            </p>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium">Filename
            <div className="mt-1 flex items-center gap-2">
              <input
                className="field"
                placeholder="audio"
                value={filename}
                onChange={(e) => { setFilename(e.target.value); setEdited(true); }}
              />
              <span className="text-sm text-muted">.mp3</span>
            </div>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn btn-accent" onClick={convert} disabled={!canConvert}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Converting…</> : "Convert"}
          </button>
          {busy && <span className="text-sm text-muted">Converting…</span>}
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {result && (
        <div className="card">
          <p className="eyebrow">Ready</p>
          <p className="mt-1 text-sm">{result.filename}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a
              className="btn inline-flex items-center gap-2"
              href={`/api/convert/${result.id}?name=${encodeURIComponent(result.filename)}`}
              download
            >
              <Download className="w-4 h-4" strokeWidth={1.75} /> Download
            </a>
            <button type="button" className="btn inline-flex items-center gap-2" onClick={saveToDrive} disabled={driveSaving}>
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
