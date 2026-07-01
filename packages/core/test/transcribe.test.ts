import { describe, it, expect } from "vitest";
import {
  planChunks,
  mergeSegments,
  formatTimestamp,
  buildTranscriptHtml,
  buildSummaryPrompt,
  buildEventDetailsPrompt,
  buildLinkedInPrompt,
  buildArticlePrompt,
  docBaseName,
} from "../src/transcribe.js";

describe("planChunks", () => {
  it("splits a duration into chunkSec windows with offsets", () => {
    expect(planChunks(1500, 600)).toEqual([
      { index: 0, startSec: 0, durationSec: 600 },
      { index: 1, startSec: 600, durationSec: 600 },
      { index: 2, startSec: 1200, durationSec: 300 },
    ]);
  });
  it("returns a single chunk when shorter than chunkSec", () => {
    expect(planChunks(120, 600)).toEqual([{ index: 0, startSec: 0, durationSec: 120 }]);
  });
  it("returns one empty-edge chunk for zero/unknown duration", () => {
    expect(planChunks(0, 600)).toEqual([{ index: 0, startSec: 0, durationSec: 0 }]);
  });
});

describe("mergeSegments", () => {
  it("offsets each chunk's segment starts and concatenates in order", () => {
    const merged = mergeSegments(
      [
        { segments: [{ start: 0, text: "hello" }, { start: 5, text: "world" }] },
        { segments: [{ start: 1, text: "again" }] },
      ],
      [0, 600],
    );
    expect(merged).toEqual([
      { startSec: 0, text: "hello" },
      { startSec: 5, text: "world" },
      { startSec: 601, text: "again" },
    ]);
  });
  it("drops empty-text segments", () => {
    const merged = mergeSegments([{ segments: [{ start: 0, text: "  " }, { start: 1, text: "ok" }] }], [0]);
    expect(merged).toEqual([{ startSec: 1, text: "ok" }]);
  });
});

describe("formatTimestamp", () => {
  it("formats HH:MM:SS with zero padding", () => {
    expect(formatTimestamp(0)).toBe("00:00:00");
    expect(formatTimestamp(75)).toBe("00:01:15");
    expect(formatTimestamp(3725)).toBe("01:02:05");
  });
});

describe("buildTranscriptHtml", () => {
  it("renders summary and timestamped transcript sections, escaping html", () => {
    const html = buildTranscriptHtml("A <b>summary</b>", [{ startSec: 5, text: "first & line" }]);
    expect(html).toContain("<h1>Summary</h1>");
    expect(html).toContain("A &lt;b&gt;summary&lt;/b&gt;");
    expect(html).toContain("<h1>Transcript</h1>");
    expect(html).toContain("[00:00:05] first &amp; line");
  });
});

describe("buildSummaryPrompt", () => {
  it("wraps the transcript in a user message", () => {
    const msgs = buildSummaryPrompt("the words");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("the words");
  });
});

describe("buildEventDetailsPrompt", () => {
  it("includes context and transcript and asks for speakers and sponsors", () => {
    const msgs = buildEventDetailsPrompt("AGENDA TEXT", "TRANSCRIPT TEXT");
    const text = msgs[0].content;
    expect(msgs[0].role).toBe("user");
    expect(text).toContain("AGENDA TEXT");
    expect(text).toContain("TRANSCRIPT TEXT");
    expect(text.toLowerCase()).toContain("speakers");
    expect(text.toLowerCase()).toContain("sponsors");
  });
  it("labels the context as possibly empty without breaking", () => {
    const msgs = buildEventDetailsPrompt("", "ONLY TRANSCRIPT");
    expect(msgs[0].content).toContain("ONLY TRANSCRIPT");
  });
});

const DETAILS = {
  eventName: "SPARK Luncheon",
  eventDescription: "A closed door session on AI.",
  speakers: [{ name: "Tom Leighton", company: "Akamai" }],
  sponsors: [{ name: "Akamai Technologies", company: "" }],
};

describe("buildLinkedInPrompt", () => {
  it("encodes the required structure and grounding", () => {
    const text = buildLinkedInPrompt("TRANSCRIPT", DETAILS)[0].content;
    expect(text).toContain("Key takeaways from the session:");
    expect(text).toContain("Our sincere thanks to");
    expect(text.toLowerCase()).toContain("hashtag");
    expect(text.toLowerCase()).toContain("no sign-off");
    expect(text).toContain("em dashes");
    expect(text).toContain("Tom Leighton");
    expect(text).toContain("Akamai Technologies");
    expect(text).toContain("TRANSCRIPT");
  });
});

describe("buildArticlePrompt", () => {
  it("caps length and asks for SEO structure and takeaways", () => {
    const text = buildArticlePrompt("TRANSCRIPT", DETAILS)[0].content;
    expect(text).toContain("1000 words");
    expect(text.toLowerCase()).toContain("seo");
    expect(text.toLowerCase()).toContain("key takeaways");
    expect(text).toContain("TRANSCRIPT");
  });
});

describe("docBaseName", () => {
  it("strips a trailing media extension", () => {
    expect(docBaseName("recording.m4a")).toBe("recording");
    expect(docBaseName("Team Sync.mp3")).toBe("Team Sync");
    expect(docBaseName("clip.MP4")).toBe("clip");
  });
  it("leaves non-media names unchanged", () => {
    expect(docBaseName("notes.txt")).toBe("notes.txt");
    expect(docBaseName("talk.mp3.bak")).toBe("talk.mp3.bak");
    expect(docBaseName("plain")).toBe("plain");
  });
});
