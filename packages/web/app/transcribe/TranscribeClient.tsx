"use client";
import { useEffect, useRef, useState } from "react";

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
  const [uploadError, setUploadError] = useState<string | null>(null);
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
  }, [id]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setTx(null);
    setUploadError(null);
    try {
      const r = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "x-filename": file.name },
        body: file,
      });
      if (!r.ok) {
        setUploadError("Upload failed. Please try again.");
        return;
      }
      const data = await r.json();
      if (!data.id) {
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

  return (
    <div className="mt-8">
      <div className="card flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept="audio/*,video/*" className="text-sm text-muted" />
        <button className="btn btn-accent" onClick={upload} disabled={busy}>
          {busy ? "Uploading…" : "Transcribe"}
        </button>
      </div>
      {uploadError && (
        <p className="text-[color:#b42318] mt-3">{uploadError}</p>
      )}

      {tx && (
        <div className="card mt-5">
          <p className="eyebrow">{tx.originalFilename}</p>
          {tx.status === "error" ? (
            <p className="text-[color:#b42318]">Failed: {tx.errorMessage}</p>
          ) : tx.status === "done" ? (
            <>
              <p className="text-success">Done.</p>
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
          ) : (
            <p className="text-muted">{phaseLabel(tx.status)}</p>
          )}
        </div>
      )}
    </div>
  );
}

function phaseLabel(status: string): string {
  switch (status) {
    case "uploading": return "Uploading";
    case "transcribing": return "Transcribing audio";
    case "summarizing": return "Summarizing with Claude";
    case "creating_doc": return "Creating the Google Doc";
    default: return status;
  }
}
