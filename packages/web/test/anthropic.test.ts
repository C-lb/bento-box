import { describe, it, expect, vi } from "vitest";

function fakeClient(payload: any, stop = "end_turn") {
  return {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: stop,
        content: [{ type: "text", text: JSON.stringify(payload) }],
      })),
    },
  } as any;
}

const { scorePhoto, VISION_MODEL } = await import("../lib/anthropic.js");

describe("scorePhoto", () => {
  it("returns the parsed score and reasons", async () => {
    const client = fakeClient({ score: 87, reasons: ["clear face", "good light"] });
    const out = await scorePhoto(client, { base64: "x", mediaType: "image/jpeg", name: "a.jpg" });
    expect(out.score).toBe(87);
    expect(out.reasons).toEqual(["clear face", "good light"]);
  });
  it("clamps score and caps reasons at three", async () => {
    const client = fakeClient({ score: 250, reasons: ["a", "b", "c", "d", "e"] });
    const out = await scorePhoto(client, { base64: "x", mediaType: "image/png", name: "b.png" });
    expect(out.score).toBe(100);
    expect(out.reasons).toHaveLength(3);
  });
  it("throws on a refusal", async () => {
    const client = fakeClient({}, "refusal");
    await expect(scorePhoto(client, { base64: "x", mediaType: "image/jpeg", name: "c.jpg" })).rejects.toThrow();
  });
  it("defaults the vision model to opus", () => {
    expect(VISION_MODEL).toContain("claude-");
  });
});
