import { describe, it, expect, vi } from "vitest";
import { extractEventDetails, generateFormattedSummary } from "../lib/anthropic";

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
    const out = await generateFormattedSummary(client, "linkedin", "tx", details);
    expect(out).toBe("POST BODY");
  });
});
