import { describe, it, expect, vi } from "vitest";
import { segmentSpeakers } from "../lib/anthropic";

describe("segmentSpeakers", () => {
  it("sends the prompt and normalizes the returned groups", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ groups: [{ speaker: "Ada", startSlide: 1, endSlide: 9 }] }) }],
    }));
    const client = { messages: { create } } as any;

    const groups = await segmentSpeakers(client, [
      { index: 1, text: "Intro", notes: "" },
      { index: 2, text: "End", notes: "" },
    ]);

    expect(groups).toEqual([{ speaker: "Ada", startSlide: 1, endSlide: 2 }]); // clamped to 2 slides
    const arg = create.mock.calls[0][0];
    expect(arg.output_config.format.type).toBe("json_schema");
    const promptText = arg.messages[0].content.find((b: any) => b.type === "text").text;
    expect(promptText).toContain("Slide 1");
  });

  it("throws on refusal", async () => {
    const client = { messages: { create: vi.fn(async () => ({ stop_reason: "refusal", content: [] })) } } as any;
    await expect(segmentSpeakers(client, [{ index: 1, text: "x", notes: "" }])).rejects.toThrow();
  });
});
