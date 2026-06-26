import Anthropic from "@anthropic-ai/sdk";
import { buildVisionPrompt, type VisionScore } from "@event-editor/core/rank";

export const VISION_MODEL = process.env.EE_VISION_MODEL ?? "claude-opus-4-8";

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    reasons: { type: "array", items: { type: "string" } },
  },
  required: ["score", "reasons"],
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
