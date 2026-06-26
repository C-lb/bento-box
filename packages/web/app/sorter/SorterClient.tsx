"use client";
import { useEffect, useState } from "react";

interface Folder { id: string; name: string; }
interface Job { id: number; status: string; total: number; processed: number; errorMessage: string | null; }
interface Photo { id: number; name: string; thumbnailPath: string | null; }

export function SorterClient() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/drive/folders").then(async (r) => {
      if (r.status === 401) { setConnected(false); return; }
      setConnected(true);
      const data = await r.json();
      setFolders(data.folders ?? []);
    }).catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (jobId == null) return;
    const tick = async () => {
      const r = await fetch(`/api/sorter/jobs/${jobId}`);
      if (!r.ok) return;
      const data = await r.json();
      setJob(data.job);
      setPhotos(data.photos ?? []);
      if (data.job.status === "done" || data.job.status === "error") return true;
      return false;
    };
    let stop = false;
    const loop = async () => { while (!stop) { if (await tick()) break; await new Promise((r) => setTimeout(r, 1000)); } };
    loop();
    return () => { stop = true; };
  }, [jobId]);

  async function scan() {
    if (!folderId) return;
    setBusy(true);
    const folder = folders.find((f) => f.id === folderId);
    const r = await fetch("/api/sorter/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, folderName: folder?.name }),
    });
    const data = await r.json();
    setBusy(false);
    if (data.jobId) { setJobId(data.jobId); setJob(null); setPhotos([]); }
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
    <div className="mt-8">
      <div className="card flex items-center gap-3">
        <select
          className="rounded-lg border border-line bg-surface px-3 py-2"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">Choose a folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button className="btn btn-accent" onClick={scan} disabled={!folderId || busy}>
          {busy ? "Starting…" : "Scan folder"}
        </button>
      </div>

      {job && (
        <div className="card mt-5">
          <p className="eyebrow">Scan</p>
          {job.status === "error" ? (
            <p className="text-[color:#b42318]">Scan failed: {job.errorMessage}</p>
          ) : (
            <p className="text-muted">
              {job.status === "done" ? "Done" : "Scanning"} — {job.processed} of {job.total}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((p) => (
              <div key={p.id} className="rounded-lg border border-line p-2">
                <div className="aspect-square overflow-hidden rounded bg-canvas" />
                <p className="mt-2 truncate text-xs text-muted" title={p.name}>{p.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
