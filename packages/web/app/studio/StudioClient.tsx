"use client";
import { useEffect, useState } from "react";
import { FRAME_LIST } from "@event-editor/core/frames";

interface Folder { id: string; name: string; }
interface DriveImg { id: string; name: string; }
interface Headshot { id: number; status: string; imageUrl: string | null; errorMessage: string | null; }

export function StudioClient() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [images, setImages] = useState<DriveImg[]>([]);
  const [fileId, setFileId] = useState("");
  const [frameId, setFrameId] = useState(FRAME_LIST[0]?.id ?? "");
  const [nameText, setNameText] = useState("");
  const [titleText, setTitleText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hsId, setHsId] = useState<number | null>(null);
  const [hs, setHs] = useState<Headshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/drive/folders").then(async (r) => {
      if (r.status === 401) { setConnected(false); return; }
      setConnected(true);
      setFolders((await r.json()).folders ?? []);
    }).catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (!folderId) { setImages([]); return; }
    setFileId("");
    fetch(`/api/studio/images?folderId=${encodeURIComponent(folderId)}`)
      .then((r) => r.json()).then((d) => setImages(d.images ?? [])).catch(() => setImages([]));
  }, [folderId]);

  useEffect(() => {
    if (hsId == null) return;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        const r = await fetch(`/api/studio/headshots/${hsId}`);
        if (r.ok) {
          const d = await r.json();
          setHs(d.headshot);
          if (d.headshot.status === "done" || d.headshot.status === "error") break;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
    };
    loop();
    return () => { stop = true; };
  }, [hsId]);

  async function generate() {
    if (!fileId || !frameId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/studio/headshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveFileId: fileId, frameId, nameText, titleText }),
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

  if (connected === false) {
    return (
      <div className="card mt-8">
        <p className="text-muted">Connect your Google account to read Drive folders.</p>
        <a className="btn btn-accent mt-4" href="/api/google/auth">Connect Google Drive</a>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="card">
        <p className="eyebrow">Step 1 — choose a photo</p>
        <select
          className="mt-3 rounded-lg border border-line bg-surface px-3 py-2"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">Choose a folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {images.length > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-3">
            {images.map((img) => (
              <button
                key={img.id}
                onClick={() => setFileId(img.id)}
                className={`overflow-hidden rounded-lg border ${fileId === img.id ? "border-accent" : "border-line"}`}
                title={img.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/studio/drive-thumb/${img.id}`} alt={img.name} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p className="eyebrow">Step 2 — pick a frame</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {FRAME_LIST.map((f) => (
            <button
              key={f.id}
              onClick={() => setFrameId(f.id)}
              className={`btn ${frameId === f.id ? "btn-accent" : ""}`}
            >
              {f.label}
            </button>
          ))}
          <span className="self-center text-muted">Canva brand templates — coming soon</span>
        </div>
      </div>

      <div className="card">
        <p className="eyebrow">Step 3 — details</p>
        <div className="mt-3 flex flex-col gap-3 sm:max-w-md">
          <input className="rounded-lg border border-line bg-surface px-3 py-2" placeholder="Name"
            value={nameText} onChange={(e) => setNameText(e.target.value)} />
          <input className="rounded-lg border border-line bg-surface px-3 py-2" placeholder="Title"
            value={titleText} onChange={(e) => setTitleText(e.target.value)} />
        </div>
        <button className="btn btn-accent mt-4" onClick={generate} disabled={!fileId || busy}>
          {busy ? "Starting…" : "Generate headshot"}
        </button>
        {err && <p className="mt-3 text-muted">{err}</p>}
      </div>

      {hs && (
        <div className="card">
          <p className="eyebrow">Result</p>
          {hs.status === "error" ? (
            <p className="mt-3 text-muted">Render failed: {hs.errorMessage}</p>
          ) : hs.status === "done" && hs.imageUrl ? (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hs.imageUrl} alt="headshot" className="w-72 rounded-lg border border-line" />
              <a className="btn btn-accent mt-4" href={hs.imageUrl} download={`headshot-${hs.id}.png`}>Download PNG</a>
            </div>
          ) : (
            <p className="mt-3 text-muted">Rendering…</p>
          )}
        </div>
      )}
    </div>
  );
}
