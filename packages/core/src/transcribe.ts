import { LINKEDIN_EXAMPLES, ARTICLE_EXAMPLES } from "./summary-examples.js";

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

export interface EventDetails {
  eventName: string;
  eventDescription: string;
  speakers: { name: string; company: string }[];
  sponsors: { name: string; company: string }[];
}

export function buildEventDetailsPrompt(
  contextText: string,
  transcript: string,
): { role: "user"; content: string }[] {
  const context = contextText.trim() || "(no context document was provided)";
  return [
    {
      role: "user",
      content:
        "You extract factual event details from a supporting document and a transcript. " +
        "Return the event name, a one or two sentence event description, the speakers, and the " +
        "sponsors or partners, with each person's or sponsor's company. Prefer the supporting " +
        "document for correct spelling of names and companies; fall back to the transcript. " +
        "If a value is unknown, use an empty string or an empty list. Do not invent names. " +
        "Do not use em dashes.\n\n" +
        "Supporting document:\n" + context + "\n\n" +
        "Transcript:\n" + transcript,
    },
  ];
}

function detailsBlock(details: EventDetails): string {
  const speakers = details.speakers.map((s) => s.company ? `${s.name} (${s.company})` : s.name).join(", ") || "(none provided)";
  const sponsors = details.sponsors.map((s) => s.company ? `${s.name} (${s.company})` : s.name).join(", ") || "(none provided)";
  return (
    `Event name: ${details.eventName || "(unknown)"}\n` +
    `Event description: ${details.eventDescription || "(unknown)"}\n` +
    `Speakers: ${speakers}\n` +
    `Sponsors and partners: ${sponsors}`
  );
}

export function buildLinkedInPrompt(
  transcript: string,
  details: EventDetails,
): { role: "user"; content: string }[] {
  const examples = LINKEDIN_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join("\n\n---\n\n");
  return [
    {
      role: "user",
      content:
        "Write a LinkedIn post recapping this event, in the style of the examples below.\n\n" +
        "Structure, exactly:\n" +
        "1. Two to four short paragraphs, each two to three lines, opening on what the session was about.\n" +
        "2. A line reading exactly: Key takeaways from the session:\n" +
        "3. Bullet pointers (use the bullet character) drawn from what the key speakers said.\n" +
        "4. A line starting: Our sincere thanks to ... naming the speakers for sharing their insights, " +
        "and separately thanking the sponsors and partners for their support.\n" +
        "5. A final line of topic hashtags, written plainly as #Topic with no spaces inside each tag " +
        "(for example: #AI #EnterpriseAI). Never prefix a hashtag with the literal word hashtag.\n\n" +
        "Rules: no sign-off, no closing salutation, no author name at the end. No em dashes. " +
        "Only thank people and sponsors named in the details below; do not invent names.\n\n" +
        "Event details:\n" + detailsBlock(details) + "\n\n" +
        "Transcript:\n" + transcript + "\n\n" +
        "Style examples:\n" + examples,
    },
  ];
}

export function buildArticlePrompt(
  transcript: string,
  details: EventDetails,
): { role: "user"; content: string }[] {
  const examples = ARTICLE_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join("\n\n---\n\n");
  return [
    {
      role: "user",
      content:
        "Write an article recapping this event, in the style of the examples below.\n\n" +
        "Requirements: at most 1000 words. Follow SEO best practices: a clear title, descriptive " +
        "section headers, and natural use of the event's key topics as keywords. Write every section " +
        "header in bold using **Header** on its own line. Do not use Markdown number-sign (#) headers. " +
        "Include a clear key takeaways treatment (a short list or a dedicated section). No em dashes. " +
        "Only reference people and sponsors named in the details below; do not invent names.\n\n" +
        "Event details:\n" + detailsBlock(details) + "\n\n" +
        "Transcript:\n" + transcript + "\n\n" +
        "Style examples:\n" + examples,
    },
  ];
}
