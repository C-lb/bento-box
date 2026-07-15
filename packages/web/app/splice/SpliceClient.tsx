"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Loader2, Volume2, VolumeX, X } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { PastRuns } from "@/components/PastRuns";
import { runFileUrl } from "@/lib/past-runs";
import { uploadWithProgress } from "@/lib/upload";

type Kind = "video" | "audio";
type Scale = "match" | "1080" | "720";

interface ClipRow {
  key: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  start: number;
  end: number;
  volume: number;
}

interface Result { id: string; filename: string; kind: Kind }

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `clip-${Date.now().toString(36)}-${keySeq}`;
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SpliceClient() {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [kind, setKind] = useState<Kind | null>(null);
  const [scale, setScale] = useState<Scale>("match");
  const [clips, setClips] = useState<ClipRow[]>([]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Keep a ref in sync with clips so the unmount cleanup revokes the URLs that
  // are actually live, not the empty initial-render closure.
  const clipsRef = useRef(clips);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => () => {
    for (const c of clipsRef.current) URL.revokeObjectURL(c.url);
  }, []);

  function onPickFiles() {
    const files = Array.from(fileRef.current?.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setResult(null);

    let activeKind = kind;
    const accepted: File[] = [];
    for (const f of files) {
      const fileKind: Kind = f.type.startsWith("video") ? "video" : "audio";
      if (activeKind === null) activeKind = fileKind;
      if (fileKind !== activeKind) {
        setError(`This tool joins one type of clip at a time. Skipped "${f.name}" (${fileKind}) since the sequence is already ${activeKind}.`);
        continue;
      }
      accepted.push(f);
    }
    if (activeKind && kind === null) setKind(activeKind);
    if (fileRef.current) fileRef.current.value = "";

    for (const f of accepted) {
      const url = URL.createObjectURL(f);
      const key = nextKey();
      const el = f.type.startsWith("video") ? document.createElement("video") : document.createElement("audio");
      el.preload = "metadata";
      el.src = url;
      el.onloadedmetadata = () => {
        const duration = Number.isFinite(el.duration) ? el.duration : 0;
        setClips((prev) => prev.map((c) => (c.key === key ? { ...c, duration, end: duration } : c)));
      };
      setClips((prev) => [
        ...prev,
        { key, file: f, url, name: f.name, duration: 0, start: 0, end: 0, volume: 1 },
      ]);
    }
  }

  function updateClip(key: string, patch: Partial<ClipRow>) {
    setClips((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function removeClip(key: string) {
    const found = clips.find((c) => c.key === key);
    if (found) URL.revokeObjectURL(found.url);
    const next = clips.filter((c) => c.key !== key);
    setClips(next);
    if (next.length === 0) setKind(null);
  }

  function moveClip(key: string, dir: -1 | 1) {
    setClips((prev) => {
      const i = prev.findIndex((c) => c.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function toggleMute(key: string) {
    setClips((prev) =>
      prev.map((c) => (c.key === key ? { ...c, volume: c.volume === 0 ? 1 : 0 } : c)),
    );
  }

  const canJoin = !busy && clips.length > 0 && clips.every((c) => c.start < c.end && c.duration > 0);

  async function join() {
    if (!kind) return;
    setError(null);
    setResult(null);
    setBusy(true);
    setProgress(0);
    try {
      const manifest = {
        kind,
        scale,
        clips: clips.map((c) => ({ start: c.start, end: c.end, volume: c.volume })),
      };
      const fd = new FormData();
      for (const c of clips) fd.append("file", c.file);
      fd.append("manifest", JSON.stringify(manifest));
      const r = await uploadWithProgress("/api/splice", fd, setProgress);
      if (r.status === 401) { window.location.assign("/login"); return; }
      const data: any = await r.json().catch(() => null);
      if (r.status === 413) throw new Error(data?.error ?? "Files are too large.");
      if (!r.ok || !data?.id) throw new Error(data?.error ?? "Join failed");
      setResult({ id: data.id, filename: data.filename, kind: data.kind ?? kind });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <label className="block text-sm font-medium">Add clips
          <input
            ref={fileRef}
            type="file"
            accept={kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "video/*,audio/*"}
            multiple
            onChange={onPickFiles}
            className="field mt-1 min-h-[44px] sm:min-h-0 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
          />
        </label>
        <p className="mt-1 text-sm text-muted">
          {kind ? `Building a ${kind} sequence. Every clip you add must be ${kind}.` : "Video or audio, pick the first clip and the rest must match its type."}
        </p>

        {kind === "video" && (
          <div className="mt-4">
            <p className="text-sm font-medium">Output scale</p>
            <div className="mt-1">
              <Segmented
                options={[
                  { value: "match", label: "Match first" },
                  { value: "1080", label: "1080p" },
                  { value: "720", label: "720p" },
                ]}
                value={scale}
                onChange={(v) => setScale(v as Scale)}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <PastRuns
            tool="splice"
            buttonLabel="See past splices"
            panelTitle="Recent splices"
            emptyLabel="No splices yet."
            fileUrl={(o) => runFileUrl("splice", o)}
          />
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {clips.length > 0 && (
        <div className="space-y-3">
          {clips.map((c, i) => (
            <div key={c.key} className="card">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{i + 1}. {c.name}</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn py-1.5 px-2.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 justify-center"
                    onClick={() => moveClip(c.key, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                  >
                    <ArrowUp className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="btn py-1.5 px-2.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 justify-center"
                    onClick={() => moveClip(c.key, 1)}
                    disabled={i === clips.length - 1}
                    aria-label="Move down"
                  >
                    <ArrowDown className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="btn py-1.5 px-2.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 justify-center"
                    onClick={() => removeClip(c.key)}
                    aria-label="Remove clip"
                  >
                    <X className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </div>
              </div>

              <div className="mt-3">
                {kind === "video" ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video controls src={c.url} className="w-full max-h-64 rounded-lg bg-raised" />
                ) : (
                  <audio controls src={c.url} className="w-full" />
                )}
              </div>

              {c.duration > 0 ? (
                <>
                  <div className="mt-4">
                    <p className="text-sm font-medium">
                      Trim: {fmt(c.start)} to {fmt(c.end)} <span className="text-muted">({fmt(c.end - c.start)} kept)</span>
                    </p>
                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                      <label className="flex-1 text-sm text-muted">Start
                        <input
                          type="range"
                          min={0}
                          max={c.duration}
                          step={0.1}
                          value={c.start}
                          onChange={(e) => {
                            const v = Math.min(Number(e.target.value), c.end - 0.1);
                            updateClip(c.key, { start: Math.max(0, v) });
                          }}
                          className="w-full"
                        />
                      </label>
                      <label className="flex-1 text-sm text-muted">End
                        <input
                          type="range"
                          min={0}
                          max={c.duration}
                          step={0.1}
                          value={c.end}
                          onChange={(e) => {
                            const v = Math.max(Number(e.target.value), c.start + 0.1);
                            updateClip(c.key, { end: Math.min(c.duration, v) });
                          }}
                          className="w-full"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      className="btn py-1.5 px-2.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 justify-center"
                      onClick={() => toggleMute(c.key)}
                      aria-label={c.volume === 0 ? "Unmute" : "Mute"}
                    >
                      {c.volume === 0 ? <VolumeX className="w-4 h-4" strokeWidth={1.75} /> : <Volume2 className="w-4 h-4" strokeWidth={1.75} />}
                    </button>
                    <label className="flex-1 text-sm text-muted">Volume: {Math.round(c.volume * 100)}%
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={c.volume}
                        onChange={(e) => updateClip(c.key, { volume: Number(e.target.value) })}
                        className="w-full"
                      />
                    </label>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">Reading clip length…</p>
              )}
            </div>
          ))}
        </div>
      )}

      {clips.length > 0 && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
              onClick={join}
              disabled={!canJoin}
            >
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Joining…</> : "Join clips"}
            </button>
            {busy && <span className="text-sm text-muted">This can take a while for long clips.</span>}
          </div>
          {busy && (
            <div className="mt-3 h-1.5 w-full rounded-full bg-line overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="card">
          <p className="eyebrow">Ready</p>
          <p className="mt-1 text-sm">{result.filename}</p>

          <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <a
              className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
              href={`/api/splice/${result.id}?name=${encodeURIComponent(result.filename)}&kind=${result.kind}`}
              download
            >
              <Download className="w-4 h-4" strokeWidth={1.75} /> Download
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
