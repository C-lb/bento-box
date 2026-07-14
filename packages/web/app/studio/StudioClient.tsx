"use client";
import { useCallback, useEffect, useState } from "react";
import { FRAME_LIST } from "@event-editor/core/frames";
import { StatusBadge } from "@/components/StatusBadge";
import { headshotStatusView } from "@/lib/status";
import { usePollWhileVisible } from "@/lib/use-visible-poll";
import { FolderPicker, type PickedFolder } from "@/components/FolderPicker";

interface DriveImg { id: string; name: string; }
interface Headshot { id: number; status: string; imageUrl: string | null; errorMessage: string | null; }

export function StudioClient() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [source, setSource] = useState<"drive" | "upload">("drive");
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  const [images, setImages] = useState<DriveImg[]>([]);
  const [fileId, setFileId] = useState("");
  const [pickedName, setPickedName] = useState("");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [frameId, setFrameId] = useState(FRAME_LIST[0]?.id ?? "");
  const [nameText, setNameText] = useState("");
  const [titleText, setTitleText] = useState("");
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [uppercase, setUppercase] = useState(false);
  const [textColor, setTextColor] = useState(""); // "" keeps the frame's own colours
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [hsId, setHsId] = useState<number | null>(null);
  const [hs, setHs] = useState<Headshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<"local" | "canva">("local");
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [canvaConnected, setCanvaConnected] = useState<boolean | null>(null);

  useEffect(() => {
    // Probe for the Google connection only; the FolderPicker lists on demand.
    fetch("/api/drive/folders?parent=root").then((r) => setConnected(r.status !== 401)).catch(() => setConnected(false));
  }, []);

  // "Send to Headshot Studio" from the ranker links here with the Drive file id
  // and name, so preselect that photo, ready to generate.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const driveFileId = params.get("driveFileId");
    if (driveFileId) {
      setSource("drive");
      setFileId(driveFileId);
      setPickedName(params.get("name") ?? driveFileId);
    }
  }, []);

  useEffect(() => {
    if (!folder) { setImages([]); return; }
    setFileId("");
    fetch(`/api/studio/images?folderId=${encodeURIComponent(folder.id)}`)
      .then((r) => r.json()).then((d) => setImages(d.images ?? [])).catch(() => setImages([]));
  }, [folder]);

  useEffect(() => {
    if (renderer !== "canva" || canvaConnected !== null) return;
    fetch("/api/studio/templates").then(async (r) => {
      if (r.status === 401) { setCanvaConnected(false); return; }
      setCanvaConnected(true);
      setTemplates((await r.json()).templates ?? []);
    }).catch(() => setCanvaConnected(false));
  }, [renderer, canvaConnected]);

  const hsSettled = hs != null && (hs.status === "done" || hs.status === "error");
  // Stable callback: usePollWhileVisible re-arms its interval whenever `fn`
  // changes identity, so this must be memoized (see transcribe/TranscribeClient).
  const pollTick = useCallback(() => {
    if (hsId == null) return;
    (async () => {
      const r = await fetch(`/api/studio/headshots/${hsId}`);
      if (!r.ok) return;
      const d = await r.json();
      setHs(d.headshot);
    })();
  }, [hsId]);
  usePollWhileVisible(pollTick, 1000, hsId != null && !hsSettled);

  const hasSource = source === "upload" ? !!uploadId : !!fileId;

  async function onPickFile(file: File) {
    setUploading(true);
    setErr(null);
    setUploadId(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/studio/upload", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Upload failed");
      setUploadId(d.uploadId);
      setUploadName(file.name);
      setUploadPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  // Native Google Picker (same mechanism as the slicer): lets you pick an image
  // from anywhere in Drive, including shared drives and search, not just a folder.
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
    setErr(null);
    try {
      const r = await fetch("/api/drive/token");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not open the Drive picker");
      await loadGapiPicker();
      const w = window as any;
      const view = new w.google.picker.DocsView(w.google.picker.ViewId.DOCS_IMAGES)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const builder = new w.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.access_token);
      if (data.apiKey) builder.setDeveloperKey(data.apiKey);
      if (data.appId) builder.setAppId(data.appId);
      const picker = builder
        .setCallback((res: any) => {
          if (res.action === w.google.picker.Action.PICKED) {
            const doc = res.docs?.[0];
            if (doc) { setFileId(doc.id); setPickedName(doc.name ?? doc.id); }
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function generate() {
    if (!hasSource) return;
    if (renderer === "canva" && !templateId) return;
    if (renderer === "local" && !frameId) return;
    setBusy(true);
    setErr(null);
    try {
      const src = source === "upload" ? { uploadId } : { driveFileId: fileId };
      const style = { bold, italic, uppercase, zoom, ...(textColor ? { color: textColor } : {}) };
      const payload = renderer === "canva"
        ? { renderer, ...src, templateId, nameText, titleText }
        : { renderer, ...src, frameId, nameText, titleText, style };
      const r = await fetch("/api/studio/headshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "failed to start");
      setHsId(d.id); setHs(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setFolder(null);
    setImages([]);
    setFileId("");
    setPickedName("");
    setUploadId(null);
    setUploadName("");
    setUploadPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setNameText("");
    setTitleText("");
    setBold(false);
    setItalic(false);
    setUppercase(false);
    setTextColor("");
    setZoom(1);
    setTemplateId("");
    setHsId(null);
    setHs(null);
    setErr(null);
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="card">
        <p className="eyebrow">Step 1: choose a photo</p>
        <div className="mt-3 inline-flex rounded-lg border border-line p-1">
          {([
            { id: "drive", label: "Google Drive" },
            { id: "upload", label: "Upload a file" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSource(opt.id)}
              className={`min-h-[44px] sm:min-h-0 px-4 py-1.5 rounded-md text-sm ${source === opt.id ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {source === "drive" && connected === false && (
          <div className="mt-4">
            <p className="text-sm text-muted">Connect your Google account to read Drive folders, or upload a file instead.</p>
            <a className="btn btn-accent mt-3 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center inline-flex items-center" href="/api/google/auth">Connect Google Drive</a>
          </div>
        )}

        {source === "drive" && connected !== false && (
          <>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <button type="button" className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={chooseFromDrive}>
                Choose from Google Drive
              </button>
              <span className="text-sm text-muted">or browse a folder</span>
            </div>
            <div className="mt-3">
              <FolderPicker value={folder} onChange={setFolder} />
            </div>
            {images.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {images.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => { setFileId(img.id); setPickedName(img.name); }}
                    className={`overflow-hidden rounded-lg border ${fileId === img.id ? "border-accent" : "border-line"}`}
                    title={img.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/studio/drive-thumb/${img.id}`} alt={img.name} className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            {fileId && (
              <div className="mt-4 flex items-center gap-3">
                <div className="h-20 w-20 overflow-hidden rounded-lg border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/studio/drive-thumb/${fileId}`} alt={pickedName || "selected"} className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink" title={pickedName}>{pickedName || "Selected photo"}</p>
                  <p className="text-sm text-success">Ready to use</p>
                </div>
              </div>
            )}
          </>
        )}

        {source === "upload" && (
          <div className="mt-4">
            <label className="btn min-h-[44px] sm:min-h-0 inline-flex cursor-pointer items-center gap-2">
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }}
                disabled={uploading || busy}
              />
              {uploading ? "Uploading…" : uploadId ? "Choose a different photo" : "Choose a photo"}
            </label>
            {uploadPreview && (
              <div className="mt-4 flex items-center gap-3">
                <div className="h-20 w-20 overflow-hidden rounded-lg border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={uploadPreview} alt={uploadName} className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink" title={uploadName}>{uploadName}</p>
                  {uploadId && <p className="text-sm text-success">Ready to use</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <p className="eyebrow">Step 2: renderer</p>
        <div className="mt-3 inline-flex rounded-lg border border-line p-1">
          {(["local", "canva"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRenderer(r)}
              className={`min-h-[44px] sm:min-h-0 px-4 py-1.5 rounded-md text-sm ${renderer === r ? "bg-accent text-white" : "text-muted"}`}
            >
              {r === "local" ? "Local" : "Canva"}
            </button>
          ))}
        </div>

        {renderer === "local" && (
          <div className="mt-4 flex flex-wrap gap-3">
            {FRAME_LIST.map((f) => (
              <button
                key={f.id}
                onClick={() => setFrameId(f.id)}
                className={`btn min-h-[44px] sm:min-h-0 ${frameId === f.id ? "btn-accent" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {renderer === "canva" && canvaConnected === false && (
          <p className="mt-4 text-sm text-muted">
            Canva is not connected. <a className="underline" href="/settings">Connect it in settings</a>.
          </p>
        )}

        {renderer === "canva" && canvaConnected && (
          <label className="mt-4 block">
            <span className="eyebrow">Brand template</span>
            <select
              className="field mt-1 w-full sm:w-auto min-h-[44px] sm:min-h-0"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Select a template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="card">
        <p className="eyebrow">Step 3: details</p>
        <div className="mt-3 flex flex-col gap-3 sm:max-w-md">
          <input className="field min-h-[44px] sm:min-h-0" placeholder="Name"
            value={nameText} onChange={(e) => setNameText(e.target.value)} />
          <input className="field min-h-[44px] sm:min-h-0" placeholder="Title"
            value={titleText} onChange={(e) => setTitleText(e.target.value)} />
        </div>

        {renderer === "local" && (
          <div className="mt-4 flex flex-col gap-4 sm:max-w-md">
            <div>
              <span className="mb-1.5 block text-sm text-muted">Text style</span>
              <div className="flex flex-wrap gap-2">
                {([
                  { on: bold, set: setBold, label: "Bold", cls: "font-bold" },
                  { on: italic, set: setItalic, label: "Italic", cls: "italic" },
                  { on: uppercase, set: setUppercase, label: "Uppercase", cls: "uppercase" },
                ] as const).map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    aria-pressed={t.on}
                    onClick={() => t.set((v) => !v)}
                    className={`btn min-h-[44px] sm:min-h-0 text-sm ${t.cls} ${t.on ? "btn-accent" : ""}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-sm text-muted">Text colour</span>
              <div className="flex items-center gap-3">
                <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-line sm:h-9 sm:w-9" data-tip="Pick a colour">
                  <input
                    type="color"
                    value={textColor || "#000000"}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="h-14 w-14 cursor-pointer border-0 bg-transparent p-0"
                    aria-label="Text colour"
                  />
                </label>
                <span className="text-sm text-muted">{textColor ? textColor.toUpperCase() : "Frame default"}</span>
                {textColor && (
                  <button type="button" className="text-sm text-ink underline underline-offset-2" onClick={() => setTextColor("")}>
                    Reset
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 flex items-center justify-between text-sm text-muted">
                <span>Zoom on face</span>
                <span className="text-ink">{zoom.toFixed(1)}x</span>
              </label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
                aria-label="Zoom on face"
              />
            </div>
          </div>
        )}
        <button
          className="btn btn-accent mt-4 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
          onClick={generate}
          disabled={busy || uploading || !hasSource || (renderer === "canva" ? !templateId : !frameId)}
        >
          {busy ? "Starting…" : "Generate headshot"}
        </button>
        {(!hasSource || (renderer === "canva" ? !templateId : !frameId)) && (
          <p className="mt-2 text-sm text-muted">
            Pick a photo and a {renderer === "canva" ? "template" : "frame"} first.
          </p>
        )}
        {err && <p className="mt-3 text-danger">{err}</p>}
      </div>

      {hs && (
        <div className="card">
          <p className="eyebrow">Result</p>
          <div className="mt-2">
            <StatusBadge {...headshotStatusView(hs.status)} />
          </div>
          {hs.status === "error" && (
            <div className="mt-3">
              <p className="text-sm text-danger">{hs.errorMessage ?? "Something went wrong."}</p>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <button className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={generate} disabled={busy}>Try again</button>
                <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={startOver}>Start over</button>
              </div>
            </div>
          )}
          {hs.status === "done" && hs.imageUrl && (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hs.imageUrl} alt="headshot" className="w-full max-w-72 rounded-lg border border-line" />
              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <a className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center inline-flex items-center" href={hs.imageUrl} download={`headshot-${hs.id}.png`}>Download PNG</a>
                <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={startOver}>Start over</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
