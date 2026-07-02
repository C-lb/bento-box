"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Smile } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { transcriptionStatusView } from "@/lib/status";
import { Segmented } from "@/components/Segmented";
import { CopyButton } from "@/components/CopyButton";
import { summaryToHtml, summaryToPlain } from "@/lib/render-summary";
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
  likedLinkedin?: boolean;
  likedArticle?: boolean;
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

  const [draftMode, setDraftMode] = useState<"edit" | "preview">("preview");
  const [liked, setLiked] = useState<{ linkedin: boolean; article: boolean }>({ linkedin: false, article: false });
  const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const searchParams = useSearchParams();

  async function loadExisting(openId: number) {
    setId(openId);
    setFormat("general");
    setFormatText({});
    setUploadError(null);
    try {
      const r = await fetch(`/api/transcribe/${openId}`);
      const d = await r.json().catch(() => null);
      const t = d?.transcription;
      if (!t) return;
      setTx({ ...t });
      setFormatText({
        ...(t.summaryLinkedin ? { linkedin: t.summaryLinkedin } : {}),
        ...(t.summaryArticle ? { article: t.summaryArticle } : {}),
      });
      setLiked({ linkedin: !!t.likedLinkedin, article: !!t.likedArticle });
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const openId = searchParams.get("id");
    if (!openId) return;
    const n = Number(openId);
    if (!Number.isFinite(n) || n === id) return;
    loadExisting(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
    setSelRange(null);
    setDraftMode("preview");
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

  async function regenerateAll(fmt: "linkedin" | "article") {
    if (id == null) return;
    setActionBusy(true); setFormatError(null);
    try {
      const r = await fetch(`/api/transcribe/${id}/summary`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: fmt, regenerate: true }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.text) { setFormatText((m) => ({ ...m, [fmt]: d.text })); setLiked((l) => ({ ...l, [fmt]: false })); setSelRange(null); }
      else setFormatError(d?.error ?? "Could not regenerate.");
    } catch { setFormatError("Could not regenerate."); }
    finally { setActionBusy(false); }
  }

  async function regenerateSelection(fmt: "linkedin" | "article") {
    if (id == null || !selRange || selRange.end <= selRange.start) return;
    const draft = formatText[fmt] ?? "";
    setActionBusy(true); setFormatError(null);
    try {
      const r = await fetch(`/api/transcribe/${id}/summary`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: fmt, draft, selStart: selRange.start, selEnd: selRange.end }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.text) { setFormatText((m) => ({ ...m, [fmt]: d.text })); setLiked((l) => ({ ...l, [fmt]: false })); setSelRange(null); }
      else setFormatError(d?.error ?? "Could not regenerate the selection.");
    } catch { setFormatError("Could not regenerate the selection."); }
    finally { setActionBusy(false); }
  }

  async function saveEdits(fmt: "linkedin" | "article") {
    if (id == null) return;
    const draft = formatText[fmt] ?? "";
    await fetch(`/api/transcribe/${id}/summary`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: fmt, draft, save: true }),
    }).catch(() => {});
    setLiked((l) => ({ ...l, [fmt]: false })); // edited text is no longer the liked text
  }

  async function toggleLike(fmt: "linkedin" | "article") {
    if (id == null) return;
    await saveEdits(fmt); // ensure the saved draft matches what is on screen
    const r = await fetch(`/api/transcribe/${id}/like`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: fmt }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok) setLiked((l) => ({ ...l, [fmt]: !!d.liked }));
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
                    formatBusy ? <p className="text-muted">Generating!</p>
                    : formatError ? (
                      <div>
                        <p className="text-danger">{formatError}</p>
                        <button className="btn mt-3" onClick={() => loadFormat(format)}>Try again</button>
                      </div>
                    ) : (
                      <>
                        <Segmented
                          options={[{ value: "preview", label: "Preview" }, { value: "edit", label: "Edit" }]}
                          value={draftMode}
                          onChange={(v) => setDraftMode(v as "edit" | "preview")}
                        />
                        <div className="mt-3">
                          {draftMode === "preview" ? (
                            <div className="text-ink" dangerouslySetInnerHTML={{ __html: summaryToHtml(formatText[format] ?? "") }} />
                          ) : (
                            <textarea
                              ref={draftRef}
                              className="w-full min-h-[220px] rounded-[10px] border-0 bg-[var(--surface-2,#ececec)] p-3 text-ink"
                              value={formatText[format] ?? ""}
                              onChange={(e) => setFormatText((m) => ({ ...m, [format]: e.target.value }))}
                              onSelect={() => {
                                const el = draftRef.current;
                                if (!el) return;
                                setSelRange({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 });
                              }}
                              onKeyUp={() => {
                                const el = draftRef.current;
                                if (!el) return;
                                setSelRange({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 });
                              }}
                              onMouseUp={() => {
                                const el = draftRef.current;
                                if (!el) return;
                                setSelRange({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 });
                              }}
                              onBlur={() => saveEdits(format as "linkedin" | "article")}
                            />
                          )}
                        </div>
                        {formatText[format] && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              className="btn"
                              onClick={() => regenerateAll(format as "linkedin" | "article")}
                              disabled={actionBusy}
                              title="Regenerate the whole draft"
                            >
                              {actionBusy ? "Regenerating!" : "Regenerate all"}
                            </button>
                            <button
                              className="btn"
                              onClick={() => regenerateSelection(format as "linkedin" | "article")}
                              disabled={actionBusy || draftMode !== "edit" || !selRange || selRange.end <= selRange.start}
                              title="Regenerate only the selected text"
                            >
                              Regenerate selection
                            </button>
                            <CopyButton text={summaryToPlain(formatText[format]!)} html={summaryToHtml(formatText[format]!)} />
                            <button
                              type="button"
                              title="Mark this draft as good. Future drafts will use it as inspiration."
                              aria-pressed={liked[format as "linkedin" | "article"]}
                              className={`btn inline-flex items-center gap-2 ${liked[format as "linkedin" | "article"] ? "text-accent" : ""}`}
                              onClick={() => toggleLike(format as "linkedin" | "article")}
                            >
                              <Smile className="w-4 h-4" />
                            </button>
                          </div>
                        )}
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
