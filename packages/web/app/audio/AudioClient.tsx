"use client";
import { useState } from "react";
import { Download, Loader2, UploadCloud } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { PastRuns } from "@/components/PastRuns";
import { runFileUrl } from "@/lib/past-runs";

interface Result { id: string; filename: string; ext?: string }

// Shared 413/401 handling for the tool's POST endpoints: 401 bounces to login,
// 413 surfaces the server's own message instead of a generic failure.
async function readJsonOrThrow(res: { ok: boolean; status: number; json: () => Promise<any> }) {
  if (res.status === 401) { window.location.assign("/login"); throw new Error("Signed out."); }
  const data = await res.json().catch(() => null);
  if (res.status === 413) throw new Error(data?.error ?? "File is too large.");
  return data;
}

export function AudioClient({ ytDlp }: { ytDlp: boolean }) {
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [edited, setEdited] = useState(false);
  const [output, setOutput] = useState<"mp3" | "wav" | "m4a">("mp3");

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
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

  const canConvert = !busy && isUrl(url);

  // Read the /api/convert/url ndjson stream, surfacing each stage's message and
  // returning the final { id, filename, ext } once the "done" event lands.
  async function readConvertStream(r: Response): Promise<Result> {
    if (!r.ok || !r.body) {
      const data = await readJsonOrThrow(r);
      throw new Error(data?.error ?? "Conversion failed");
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done: Result | null = null;
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const evt = JSON.parse(line);
        if (evt.type === "status") setStatus(evt.message);
        else if (evt.type === "error") throw new Error(evt.error);
        else if (evt.type === "done") done = { id: evt.id, filename: evt.filename ?? filename, ext: evt.ext };
      }
    }
    if (!done) throw new Error("The conversion ended unexpectedly");
    return done;
  }

  async function convert() {
    setError(null);
    setResult(null);
    setStatus(null);
    setDriveUrl(null);
    setDriveError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/convert/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), filename, output }),
      });
      const data = await readConvertStream(r);
      setResult({ id: data.id, filename: data.filename ?? filename, ext: data.ext });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus(null);
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
        {ytDlp ? (
          <div>
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
            <p className="mt-1 text-sm text-muted">Paste a video or a Spotify track link. Spotify songs are matched to the closest YouTube result, then transcoded.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-raised px-4 py-3 shadow-raisededge">
            <p className="text-sm font-medium">Links need yt-dlp</p>
            <p className="mt-1 text-sm text-muted">
              Download yt-dlp in <a className="underline" href="/settings">settings</a> to grab audio from links.
            </p>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm font-medium">Output format</label>
          <div className="mt-1">
            <Segmented
              options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }, { value: "m4a", label: "M4A" }]}
              value={output}
              onChange={(v) => setOutput(v as "mp3" | "wav" | "m4a")}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium">Filename
            <div className="mt-1 flex items-center gap-2">
              <input
                className="field"
                placeholder="audio"
                value={filename}
                onChange={(e) => { setFilename(e.target.value); setEdited(true); }}
              />
              <span className="text-sm text-muted">.{output}</span>
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
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Converting…</> : "Get audio"}
          </button>
          <PastRuns
            tool="audio"
            buttonLabel="See past audio"
            panelTitle="Recent audio"
            emptyLabel="No audio grabs yet."
            fileUrl={(o) => runFileUrl("audio", o)}
          />
        </div>

        {busy && status && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
            <span>{status}</span>
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
