"use client";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { transcriptionStatusView } from "@/lib/status";
import { Segmented } from "@/components/Segmented";
import { CopyButton } from "@/components/CopyButton";
import { EventDetailsPanel } from "./EventDetailsPanel";
import { FileDrop } from "@/components/FileDrop";

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
  transcriptText: string | null;
  hasContext: boolean;
  eventDetails: { eventName: string; eventDescription: string; speakers: { name: string; company: string }[]; sponsors: { name: string; company: string }[] } | null;
  summaryLinkedin: string | null;
  summaryArticle: string | null;
}

export function TranscribeClient() {
  const [id, setId] = useState<number | null>(null);
  const [tx, setTx] = useState<Transcription | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<HTMLInputElement>(null);
  const CONTEXT_ACCEPT = ".md,.markdown,.html,.pdf,.pptx";

  const [format, setFormat] = useState<"general" | "linkedin" | "article">("general");
  const [formatText, setFormatText] = useState<Record<string, string>>({});
  const [formatBusy, setFormatBusy] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);

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
      let contextId: string | null = null;
      const ctxFile = ctxRef.current?.files?.[0];
      if (ctxFile) {
        const fd = new FormData();
        fd.append("file", ctxFile);
        const cr = await fetch("/api/transcribe/context", { method: "POST", body: fd });
        const cd = await cr.json().catch(() => null);
        if (cr.ok && cd?.contextId) contextId = cd.contextId;
      }
      const headers: Record<string, string> = { "x-filename": file.name };
      if (contextId) headers["x-context-id"] = contextId;
      const r = await fetch("/api/transcribe", { method: "POST", headers, body: file });
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

  async function loadFormat(fmt: "general" | "linkedin" | "article") {
    setFormat(fmt);
    setFormatError(null);
    if (fmt === "general") return;
    if (formatText[fmt]) return;
    if (id == null) return;
    setFormatBusy(true);
    try {
      const r = await fetch(`/api/transcribe/${id}/summary`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: fmt }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.text) setFormatText((m) => ({ ...m, [fmt]: d.text }));
      else setFormatError(d?.error ?? "Could not generate this format.");
    } catch { setFormatError("Could not generate this format."); }
    finally { setFormatBusy(false); }
  }

  const inProgress = busy || (id != null && tx != null && tx.status !== "done" && tx.status !== "error");

  return (
    <div className="mt-8">
      <div className="card flex flex-wrap items-center gap-3">
        <div className="min-w-[260px] flex-1">
          <FileDrop
            inputRef={fileRef}
            accept={ACCEPT}
            onChange={setHasFile}
            label="Drop an audio or video file here, or click to browse"
          />
        </div>
        <button
          className={`btn ${inProgress ? "btn-progress" : "btn-accent"}`}
          onClick={upload}
          disabled={inProgress || !hasFile}
        >
          {inProgress ? "Transcribing!" : "Transcribe"}
        </button>
        {!hasFile && <span className="text-sm text-muted">Add a file first</span>}
        <div className="basis-full text-sm text-muted">
          <p>Audio: {AUDIO_FORMATS.join(", ")}.</p>
          <p className="mt-1">Video (audio is extracted): {VIDEO_FORMATS.join(", ")}.</p>
        </div>
        <div className="basis-full mt-2">
          <p className="text-sm font-medium">Optional: add context (agenda, deck, or notes)</p>
          <div className="mt-1">
            <FileDrop
              inputRef={ctxRef}
              accept={CONTEXT_ACCEPT}
              label="Drop a context file here, or click to browse"
            />
          </div>
          <p className="mt-1 text-sm text-muted">Accepted: Markdown, HTML, PDF, PPTX. Used to ground the summaries with names and sponsors.</p>
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
              {tx.eventDetails && (
                <EventDetailsPanel
                  id={id!}
                  initial={tx.eventDetails}
                  onSaved={() => { setFormatText({}); setFormat("general"); }}
                />
              )}
              <div className="mt-5">
                <Segmented
                  options={[{ value: "general", label: "General" }, { value: "linkedin", label: "LinkedIn" }, { value: "article", label: "Article" }]}
                  value={format}
                  onChange={(v) => loadFormat(v as any)}
                />
                <div className="card mt-3">
                  {format === "general" && (
                    <p className="whitespace-pre-wrap text-ink">{tx.summaryText}</p>
                  )}
                  {format !== "general" && (
                    formatBusy ? <p className="text-muted">Generating…</p>
                    : formatError ? (
                      <div>
                        <p className="text-danger">{formatError}</p>
                        <button className="btn mt-3" onClick={() => loadFormat(format)}>Try again</button>
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-ink">{formatText[format]}</p>
                        {formatText[format] && <div className="mt-3"><CopyButton text={formatText[format]} /></div>}
                      </>
                    )
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
