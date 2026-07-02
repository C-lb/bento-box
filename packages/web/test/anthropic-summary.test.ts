import { describe, it, expect, vi } from "vitest";
import { extractEventDetails, generateFormattedSummary, regenerateSelection } from "../lib/anthropic";

const details = { eventName: "E", eventDescription: "D", speakers: [], sponsors: [] };

describe("extractEventDetails", () => {
  it("parses structured JSON from the model", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(details) }] })) } } as any;
    const out = await extractEventDetails(client, "ctx", "tx");
    expect(out.eventName).toBe("E");
    expect(Array.isArray(out.speakers)).toBe(true);
  });
});

describe("generateFormattedSummary", () => {
  it("returns the model text for a format", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "POST BODY" }] })) } } as any;
    const out = await generateFormattedSummary(client, "linkedin", "tx", details, ["EX"]);
    expect(out).toBe("POST BODY");
  });
});

describe("regenerateSelection", () => {
  it("returns the rewritten span text", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "NEW SPAN" }] })) } } as any;
    const out = await regenerateSelection(client, "article", "FULL", "OLD SPAN", details, []);
    expect(out).toBe("NEW SPAN");
  });
});
