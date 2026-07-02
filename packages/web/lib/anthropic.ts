import Anthropic from "@anthropic-ai/sdk";
import { buildVisionPrompt, type VisionScore } from "@event-editor/core/rank";
import { buildSummaryPrompt, buildEventDetailsPrompt, buildLinkedInPrompt, buildArticlePrompt, buildSelectionRewritePrompt, type EventDetails } from "@event-editor/core/transcribe";
import { buildSpeakerSegmentPrompt, normalizeSpeakerGroups, type SlideText, type SpeakerGroup } from "@event-editor/core/pptx";

export const VISION_MODEL = process.env.EE_VISION_MODEL ?? "claude-opus-4-8";

export const SUMMARY_MODEL = process.env.EE_SUMMARY_MODEL ?? "claude-opus-4-8";

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    reasons: { type: "array", items: { type: "string" } },
  },
  required: ["score", "reasons"],
  additionalProperties: false,
} as const;

const DETAILS_SCHEMA = {
  type: "object",
  properties: {
    eventName: { type: "string" },
    eventDescription: { type: "string" },
    speakers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, company: { type: "string" } }, required: ["name", "company"], additionalProperties: false } },
    sponsors: { type: "array", items: { type: "object", properties: { name: { type: "string" }, company: { type: "string" } }, required: ["name", "company"], additionalProperties: false } },
  },
  required: ["eventName", "eventDescription", "speakers", "sponsors"],
  additionalProperties: false,
} as const;

const SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: { speaker: { type: "string" }, startSlide: { type: "integer" }, endSlide: { type: "integer" } },
        required: ["speaker", "startSlide", "endSlide"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
} as const;

export function visionClient(): Anthropic {
  return new Anthropic();
}

export async function scorePhoto(
  client: Anthropic,
  img: { base64: string; mediaType: string; name: string },
): Promise<VisionScore> {
  const res: any = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: SCORE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } },
          { type: "text", text: buildVisionPrompt(img.name) },
        ],
      },
    ],
  } as any);

  if (res.stop_reason === "refusal") {
    throw new Error("vision model refused to score this image");
  }
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("vision model returned unparseable output");
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.slice(0, 3).map((r: unknown) => String(r))
    : [];
  return { score, reasons };
}

export async function extractEventDetails(client: Anthropic, contextText: string, transcript: string): Promise<EventDetails> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: DETAILS_SCHEMA } },
    messages: buildEventDetailsPrompt(contextText, transcript),
  } as any);
  if (res.stop_reason === "refusal") throw new Error("model refused to extract event details");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error("event details model returned unparseable output"); }
  return {
    eventName: String(parsed.eventName ?? ""),
    eventDescription: String(parsed.eventDescription ?? ""),
    speakers: Array.isArray(parsed.speakers) ? parsed.speakers.map((s: any) => ({ name: String(s.name ?? ""), company: String(s.company ?? "") })) : [],
    sponsors: Array.isArray(parsed.sponsors) ? parsed.sponsors.map((s: any) => ({ name: String(s.name ?? ""), company: String(s.company ?? "") })) : [],
  };
}

export async function generateFormattedSummary(client: Anthropic, format: "linkedin" | "article", transcript: string, details: EventDetails, examples: string[]): Promise<string> {
  const messages = format === "linkedin" ? buildLinkedInPrompt(transcript, details, examples) : buildArticlePrompt(transcript, details, examples);
  const res: any = await client.messages.create({ model: SUMMARY_MODEL, max_tokens: 4096, messages } as any);
  if (res.stop_reason === "refusal") throw new Error(`model refused to write the ${format} summary`);
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error(`${format} model returned empty output`);
  return text.trim();
}

export async function regenerateSelection(client: Anthropic, format: "linkedin" | "article", fullDraft: string, selection: string, details: EventDetails, examples: string[]): Promise<string> {
  const messages = buildSelectionRewritePrompt(format, fullDraft, selection, details, examples);
  const res: any = await client.messages.create({ model: SUMMARY_MODEL, max_tokens: 2048, messages } as any);
  if (res.stop_reason === "refusal") throw new Error("model refused to rewrite the selection");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error("selection rewrite returned empty output");
  return text.trim();
}

export async function summarizeTranscript(client: Anthropic, transcript: string): Promise<string> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2048,
    messages: buildSummaryPrompt(transcript),
  } as any);
  if (res.stop_reason === "refusal") {
    throw new Error("summary model refused to summarize this transcript");
  }
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error("summary model returned empty output");
  return text.trim();
}

export async function segmentSpeakers(client: Anthropic, slides: SlideText[]): Promise<SpeakerGroup[]> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2048,
    output_config: { format: { type: "json_schema", schema: SEGMENT_SCHEMA } },
    messages: [{ role: "user", content: [{ type: "text", text: buildSpeakerSegmentPrompt(slides) }] }],
  } as any);
  if (res.stop_reason === "refusal") throw new Error("model refused to segment the deck");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { groups: SpeakerGroup[] };
  return normalizeSpeakerGroups(parsed.groups, slides.length);
}
