"use client";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { transcriptionStatusView } from "@/lib/status";

// Anything ffmpeg can decode works — the file is re-encoded to mono 16kHz mp3
// chunks before transcription. Keep this list in sync with the input's accept.
const AUDIO_FORMATS = ["MP3", "M4A", "WAV", "FLAC", "OGG", "AAC", "AIFF", "WMA"];
const VIDEO_FORMATS = ["MP4", "MOV", "WEBM", "MKV"];
const ACCEPT = "audio/*,video/*,.m4a,.mp3,.wav,.flac,.ogg,.oga,.aac,.aiff,.wma,.mp4,.mov,.webm,.mkv";

interface Transcription {
  id: number;
  originalFilename: string;
  status: string;
  durationSec: number | null;
  summaryText: string | null;
  docUrl: string | null;
  errorMessage: string | null;
}

export function TranscribeClient() {
  const [id, setId] = useState<number | null>(null);
  const [tx, setTx] = useState<Transcription | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id == null) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/transcribe/${id}`);
      if (!r.ok) return false;
      const data = await r.json();
      setTx(data.transcription);
      return data.transcription.status === "done" || data.transcription.status === "error";
    };
    const loop = async () => { while (!stop) { if (await tick()) break; await new Promise((r) => setTimeout(r, 1500)); } };
    loop();
    return () => { stop = true; };
  }, [id, retryNonce]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setTx(null);
    setUploadError(null);
    try {
      const r = await fetch("/api/transcribe", { method: "POST", headers: { "x-filename": file.name }, body: file });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.id) {
        setUploadError("Upload failed. Please try again.");
        return;
      }
      setId(data.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (id == null) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/transcribe/${id}/retry`, { method: "POST" });
      if (!r.ok) { setUploadError("Could not restart. Please try again."); return; }
      setTx((t) => (t ? { ...t, status: "transcribing", errorMessage: null } : t));
      setRetryNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setId(null);
    setTx(null);
    setUploadError(null);
    setHasFile(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="mt-8">
      <div className="card flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="text-sm text-muted"
          onChange={(e) => setHasFile(!!e.target.files?.length)}
        />
        <button className="btn btn-accent" onClick={upload} disabled={busy || !hasFile}>
          {busy ? "Uploading…" : "Transcribe"}
        </button>
        {!hasFile && <span className="text-sm text-muted">Add a file first</span>}
        <div className="basis-full text-sm text-muted">
          <p>Audio: {AUDIO_FORMATS.join(", ")}.</p>
          <p className="mt-1">Video (audio is extracted): {VIDEO_FORMATS.join(", ")}.</p>
        </div>
      </div>
      {uploadError && <p className="mt-3 text-danger">{uploadError}</p>}

      {tx && (
        <div className="card mt-5">
          <p className="eyebrow">{tx.originalFilename}</p>
          <div className="mt-2">
            <StatusBadge {...transcriptionStatusView(tx.status)} />
          </div>

          {tx.status === "error" && (
            <div className="mt-3">
              <p className="text-sm text-danger">{tx.errorMessage ?? "Something went wrong."}</p>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-accent" onClick={retry} disabled={busy}>Try again</button>
                <button className="btn" onClick={startOver}>Start over</button>
              </div>
            </div>
          )}

          {tx.status === "done" && (
            <>
              {tx.docUrl && (
                <a className="btn btn-accent mt-3" href={tx.docUrl} target="_blank" rel="noreferrer">
                  Open in Google Docs
                </a>
              )}
              {tx.summaryText && (
                <div className="mt-4">
                  <p className="eyebrow">Summary</p>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{tx.summaryText}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
