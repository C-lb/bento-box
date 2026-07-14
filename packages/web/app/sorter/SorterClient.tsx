"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { jobStatusView } from "@/lib/status";
import { usePollWhileVisible } from "@/lib/use-visible-poll";
import { FolderPicker, type PickedFolder } from "@/components/FolderPicker";

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
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<"instagram" | "linkedin" | "profile">("linkedin");
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll the gallery to a pick and flash a ring so it's obvious which one.
  function jumpToPhoto(id: number) {
    document.getElementById(`sorter-photo-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1800);
  }
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  useEffect(() => {
    // Probe for the Google connection only; the FolderPicker lists on demand.
    fetch("/api/drive/folders?parent=root").then((r) => setConnected(r.status !== 401)).catch(() => setConnected(false));
  }, []);

  const jobSettled = job != null && (job.status === "done" || job.status === "error");
  // Stable callback: usePollWhileVisible re-arms its interval whenever `fn`
  // changes identity, so this must be memoized (see transcribe/TranscribeClient).
  const pollTick = useCallback(() => {
    if (jobId == null) return;
    (async () => {
      const r = await fetch(`/api/sorter/jobs/${jobId}`);
      if (!r.ok) return;
      const data = await r.json();
      setJob(data.job);
      setPhotos(data.photos ?? []);
    })();
  }, [jobId]);
  usePollWhileVisible(pollTick, 1000, jobId != null && !jobSettled);

  async function scan() {
    if (!folder) return;
    setBusy(true);
    try {
      const r = await fetch("/api/sorter/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folder.id, folderName: folder.name, platform }),
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
        <a className="btn btn-accent mt-4 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center inline-flex items-center" href="/api/google/auth">Connect Google Drive</a>
      </div>
    );
  }

  const ranked = photos.filter((p) => p.stage === "ranked" && p.rank != null).sort((a, b) => a.rank! - b.rank!);
  const topPicks = ranked.slice(0, 5);

  return (
    <div className="mt-8">
      <div className="card">
        <div className="mb-4">
          <span className="mb-1.5 block text-sm text-muted">Rank photos for</span>
          <div className="inline-flex flex-wrap rounded-lg border border-line bg-[#eef0f3] p-0.5">
            {([
              { id: "instagram", label: "Instagram" },
              { id: "linkedin", label: "LinkedIn" },
              { id: "profile", label: "Profile picture" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPlatform(opt.id)}
                disabled={busy}
                className={`min-h-[44px] sm:min-h-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  platform === opt.id ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <FolderPicker value={folder} onChange={setFolder} disabled={busy} />
          <button className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={scan} disabled={!folder || busy}>
            {busy ? "Starting…" : "Scan folder"}
          </button>
          {!folder && <span className="text-sm text-muted">Pick a folder first</span>}
        </div>
        <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeSubfolders}
            onChange={(e) => setIncludeSubfolders(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)] disabled:opacity-50"
          />
          <span className="text-sm">
            <span className="text-ink">Include subfolders</span>
            <span className="ml-2 text-muted">Scans every folder nested inside the one you pick, all the way down.</span>
          </span>
        </label>
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
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <button className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={scan} disabled={busy}>Scan again</button>
                <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={startOver}>Start over</button>
              </div>
            </div>
          )}

        </div>
      )}

      {job && job.status !== "error" && topPicks.length > 0 && (
        <div className="card mt-5">
          <p className="eyebrow">Top picks</p>
          <p className="mt-1 text-sm text-muted">
            The best {topPicks.length} of this batch, highest score first. Tap one to jump to it in the gallery.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {topPicks.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => jumpToPhoto(p.id)}
                data-tip="Jump to this photo"
                className="group text-left focus-visible:outline-none"
              >
                <div className="relative aspect-square overflow-hidden rounded-lg bg-canvas ring-1 ring-line transition group-hover:ring-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-accent">
                  <img src={`/api/thumb/${p.id}`} alt={p.name} className="h-full w-full object-cover" />
                  <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-xs font-semibold text-ink shadow-soft">
                    {p.rank}
                  </span>
                  {p.score != null && (
                    <span className="absolute right-1.5 top-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-xs font-medium text-ink shadow-soft">
                      {p.score}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs text-muted" title={p.name}>{p.name}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {job && job.status !== "error" && (
        <div className="card mt-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sortPhotos(photos).map((p) => (
              <div
                key={p.id}
                id={`sorter-photo-${p.id}`}
                className={`rounded-lg border p-2 transition ${
                  highlightId === p.id ? "border-accent ring-2 ring-accent" : "border-line"
                }`}
              >
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
                  <a className="btn mt-2 min-h-[44px] sm:min-h-0 w-full justify-center text-xs" href={`/studio?photoId=${p.id}`}>
                    Send to Headshot Studio
                  </a>
                )}
              </div>
            ))}
          </div>
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
