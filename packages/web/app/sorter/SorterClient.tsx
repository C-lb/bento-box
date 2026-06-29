"use client";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { jobStatusView } from "@/lib/status";

interface Folder { id: string; name: string; }
interface Job { id: number; status: string; total: number; processed: number; errorMessage: string | null; }
interface Photo {
  id: number;
  name: string;
  stage: string;
  score: number | null;
  rank: number | null;
  reasons: string[] | null;
  rejectReason: string | null;
  errorMessage: string | null;
}

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
      if (!r.ok) return false;
      const data = await r.json();
      setJob(data.job);
      setPhotos(data.photos ?? []);
      return data.job.status === "done" || data.job.status === "error";
    };
    let stop = false;
    const loop = async () => { while (!stop) { if (await tick()) break; await new Promise((r) => setTimeout(r, 1000)); } };
    loop();
    return () => { stop = true; };
  }, [jobId]);

  async function scan() {
    if (!folderId) return;
    setBusy(true);
    try {
      const folder = folders.find((f) => f.id === folderId);
      const r = await fetch("/api/sorter/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, folderName: folder?.name }),
      });
      const data = await r.json();
      if (data.jobId) { setJobId(data.jobId); setJob(null); setPhotos([]); }
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setJobId(null);
    setJob(null);
    setPhotos([]);
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
      <div className="card flex flex-wrap items-center gap-3">
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
        {!folderId && <span className="text-sm text-muted">Pick a folder first</span>}
      </div>

      {job && (
        <div className="card mt-5">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge {...jobStatusView(job.status)} />
            {job.status !== "error" && (
              <span className="text-sm text-muted">{job.processed} of {job.total}</span>
            )}
          </div>

          {job.status === "error" && (
            <div className="mt-3">
              <p className="text-sm text-danger">{job.errorMessage ?? "Something went wrong."}</p>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-accent" onClick={scan} disabled={busy}>Scan again</button>
                <button className="btn" onClick={startOver}>Start over</button>
              </div>
            </div>
          )}

          {job.status !== "error" && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sortPhotos(photos).map((p) => (
                <div key={p.id} className="rounded-lg border border-line p-2">
                  <div className="aspect-square overflow-hidden rounded bg-canvas">
                    {p.stage === "ranked" || p.stage === "rejected" || p.stage === "errored" ? (
                      <img src={`/api/thumb/${p.id}`} alt={p.name} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted" title={p.name}>{p.name}</p>
                    {p.stage === "ranked" && p.score != null && (
                      <span className="rounded bg-raised px-1.5 py-0.5 text-xs font-medium text-ink shadow-raisededge">{p.score}</span>
                    )}
                  </div>
                  {p.stage === "ranked" && p.reasons?.length ? (
                    <p className="mt-1 text-xs text-muted">{p.reasons.join(" · ")}</p>
                  ) : null}
                  {p.stage === "rejected" && (
                    <p className="mt-1 text-xs text-muted">Skipped: {p.rejectReason}</p>
                  )}
                  {p.stage === "errored" && (
                    <p className="mt-1 text-xs text-danger">Could not score{p.errorMessage ? `: ${p.errorMessage}` : ""}</p>
                  )}
                  {p.stage === "ranked" && (
                    <a className="btn mt-2 w-full justify-center text-xs" href={`/studio?photoId=${p.id}`}>
                      Send to Headshot Studio
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STAGE_ORDER: Record<string, number> = { ranked: 0, pending: 1, rejected: 2, errored: 3 };
function sortPhotos(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => {
    const s = (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9);
    if (s !== 0) return s;
    if (a.stage === "ranked") return (a.rank ?? 1e9) - (b.rank ?? 1e9);
    return a.id - b.id;
  });
}
