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

describe("proposeChain", () => {
  it("returns the parsed ordered steps for a kind-compatible plan", async () => {
    const { proposeChain } = await import("../lib/workflow/plan.js");
    const client = fakeClient({ steps: [{ toolId: "resize", instructionText: "shrink to 800px" }, { toolId: "convert", instructionText: "convert to webp" }] });
    const steps = await proposeChain(client, "shrink this photo and convert it to webp");
    expect(steps).toEqual([
      { toolId: "resize", instructionText: "shrink to 800px" },
      { toolId: "convert", instructionText: "convert to webp" },
    ]);
  });

  it("truncates the chain at the first kind-incompatible adjacency", async () => {
    const { proposeChain } = await import("../lib/workflow/plan.js");
    // resize (file->file) followed by shorten (url-text->url-text) is invalid.
    const client = fakeClient({ steps: [{ toolId: "resize", instructionText: "shrink" }, { toolId: "shorten", instructionText: "shorten a link" }] });
    const steps = await proposeChain(client, "shrink this photo then shorten a link");
    expect(steps).toEqual([{ toolId: "resize", instructionText: "shrink" }]);
  });

  it("throws on a refusal", async () => {
    const { proposeChain } = await import("../lib/workflow/plan.js");
    const client = fakeClient({}, "refusal");
    await expect(proposeChain(client, "do something")).rejects.toThrow();
  });

  it("drops steps for unknown/non-chainable toolIds", async () => {
    const { proposeChain } = await import("../lib/workflow/plan.js");
    const client = fakeClient({ steps: [{ toolId: "certificate", instructionText: "make a certificate" }, { toolId: "resize", instructionText: "shrink" }] });
    const steps = await proposeChain(client, "make a certificate then shrink a photo");
    expect(steps).toEqual([{ toolId: "resize", instructionText: "shrink" }]);
  });
});

describe("synthesizeParams", () => {
  it("returns the parsed params object", async () => {
    const { synthesizeParams } = await import("../lib/workflow/plan.js");
    const client = fakeClient({ maxW: 800, maxH: null, format: "jpeg", quality: 80 });
    const params = await synthesizeParams(client, "resize", "shrink to 800px wide, jpeg", {
      type: "object",
      properties: { maxW: {}, maxH: {}, format: {}, quality: {} },
    });
    expect(params).toEqual({ maxW: 800, maxH: null, format: "jpeg", quality: 80 });
  });

  it("throws on a refusal", async () => {
    const { synthesizeParams } = await import("../lib/workflow/plan.js");
    const client = fakeClient({}, "refusal");
    await expect(synthesizeParams(client, "resize", "shrink", {})).rejects.toThrow();
  });
});
