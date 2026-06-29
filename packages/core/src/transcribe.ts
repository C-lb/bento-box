export interface PlannedChunk {
  index: number;
  startSec: number;
  durationSec: number;
}

export interface RawSegment {
  start: number;
  text: string;
}

export interface ChunkResult {
  segments: RawSegment[];
}

export interface MergedSegment {
  startSec: number;
  text: string;
}

export function planChunks(durationSec: number, chunkSec: number): PlannedChunk[] {
  if (durationSec <= 0) return [{ index: 0, startSec: 0, durationSec: 0 }];
  const chunks: PlannedChunk[] = [];
  let index = 0;
  for (let start = 0; start < durationSec; start += chunkSec) {
    chunks.push({ index, startSec: start, durationSec: Math.min(chunkSec, durationSec - start) });
    index++;
  }
  return chunks;
}

export function mergeSegments(chunkResults: ChunkResult[], offsets: number[]): MergedSegment[] {
  const out: MergedSegment[] = [];
  chunkResults.forEach((chunk, i) => {
    const offset = offsets[i] ?? 0;
    for (const seg of chunk.segments) {
      const text = seg.text.trim();
      if (!text) continue;
      out.push({ startSec: offset + seg.start, text });
    }
  });
  return out;
}

export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildTranscriptHtml(summary: string, segments: MergedSegment[]): string {
  const summaryParas = summary
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  const lines = segments
    .map((seg) => `<p>[${formatTimestamp(seg.startSec)}] ${escapeHtml(seg.text)}</p>`)
    .join("");
  return `<h1>Summary</h1>${summaryParas}<h1>Transcript</h1>${lines}`;
}

const MEDIA_EXTS = new Set([
  "mp3", "m4a", "wav", "flac", "ogg", "oga", "aac", "aiff", "wma",
  "mp4", "mov", "webm", "mkv", "m4v",
]);

// Drop a single trailing extension only when it's a recognized audio/video
// extension, so "notes.txt" and "talk.mp3.bak" are left untouched.
export function docBaseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return filename;
  const ext = filename.slice(dot + 1).toLowerCase();
  return MEDIA_EXTS.has(ext) ? filename.slice(0, dot) : filename;
}

export function buildSummaryPrompt(transcript: string): { role: "user"; content: string }[] {
  return [
    {
      role: "user",
      content:
        "You are summarizing a transcript of an audio recording. " +
        "Write a concise summary in clear prose: open with one sentence on what the recording is about, " +
        "then the key points and any decisions or action items as short paragraphs. " +
        "Do not use em dashes. Return only the summary text, no preamble.\n\n" +
        "Transcript:\n" +
        transcript,
    },
  ];
}
