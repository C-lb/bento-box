import { describe, it, expect } from "vitest";
import {
  planChunks,
  mergeSegments,
  formatTimestamp,
  buildDocSections,
  buildDocHtml,
  type DocSection,
  buildSummaryPrompt,
  buildDocumentSummaryPrompt,
  buildEventDetailsPrompt,
  buildLinkedInPrompt,
  buildArticlePrompt,
  buildSelectionRewritePrompt,
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

describe("buildTranscriptHtml (audio doc via sections)", () => {
  it("renders summary and timestamped transcript sections, escaping html", () => {
    const html = buildDocHtml(
      buildDocSections({
        sourceKind: "audio",
        summary: "A <b>summary</b>",
        segments: [{ startSec: 5, text: "first & line" }],
      }),
    );
    expect(html).toContain("<h1>Summary</h1>");
    expect(html).toContain("A &lt;b&gt;summary&lt;/b&gt;");
    expect(html).toContain("<h1>Transcript</h1>");
    expect(html).toContain("[00:00:05] first &amp; line");
  });
});

describe("buildDocHtml (audio doc via sections)", () => {
  it("slots drafts between the summary and the transcript, in linkedin-then-article order", () => {
    const html = buildDocHtml(
      buildDocSections({
        sourceKind: "audio",
        summary: "the summary",
        segments: [{ startSec: 0, text: "words" }],
        linkedin: "post text",
        article: "article text",
      }),
    );
    const order = ["<h1>Summary</h1>", "<h1>LinkedIn post</h1>", "<h1>Article</h1>", "<h1>Transcript</h1>"].map((h) =>
      html.indexOf(h),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("omits draft sections that are missing or empty", () => {
    const html = buildDocHtml(
      buildDocSections({ sourceKind: "audio", summary: "s", segments: [], linkedin: null, article: "" }),
    );
    expect(html).not.toContain("LinkedIn post");
    expect(html).not.toContain("<h1>Article</h1>");
  });
});

describe("buildDocSections", () => {
  const base = { summary: "the summary", segments: [{ startSec: 0, text: "hello" }] };

  it("gives an audio row a timestamped Transcript section last", () => {
    const s = buildDocSections({ ...base, sourceKind: "audio" });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Transcript"]);
    expect(s[1].body).toEqual({ kind: "segments", segments: [{ startSec: 0, text: "hello" }] });
  });

  it("treats a null sourceKind as audio so old rows keep working", () => {
    const s = buildDocSections({ ...base, sourceKind: null });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Transcript"]);
  });

  it("gives a dragged document a plain Source document section last", () => {
    const s = buildDocSections({
      sourceKind: "document",
      summary: "the summary",
      sourceText: "para one\n\npara two",
    });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Source document"]);
    expect(s[1].body).toEqual({ kind: "paras", text: "para one\n\npara two" });
  });

  it("gives a gdoc row no source section at all", () => {
    const s = buildDocSections({
      sourceKind: "gdoc",
      summary: "the summary",
      sourceText: "ignored",
    });
    expect(s.map((x) => x.heading)).toEqual(["Summary"]);
  });

  it("places drafts between the summary and the source", () => {
    const s = buildDocSections({
      ...base,
      sourceKind: "audio",
      linkedin: "the post",
      article: "the article",
    });
    expect(s.map((x) => x.heading)).toEqual([
      "Summary", "LinkedIn post", "Article", "Transcript",
    ]);
  });

  it("omits drafts that are null or empty", () => {
    const s = buildDocSections({ ...base, sourceKind: "audio", linkedin: "", article: null });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Transcript"]);
  });
});

describe("buildDocHtml over sections", () => {
  it("renders headings and paragraphs, escaping the text", () => {
    const sections: DocSection[] = [
      { heading: "Summary", body: { kind: "paras", text: "a & b" } },
      { heading: "Transcript", body: { kind: "segments", segments: [{ startSec: 61, text: "hi" }] } },
    ];
    expect(buildDocHtml(sections)).toBe(
      "<h1>Summary</h1><p>a &amp; b</p><h1>Transcript</h1><p>[00:01:01] hi</p>",
    );
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

describe("buildDocumentSummaryPrompt", () => {
  it("frames the input as a document, not a recording", () => {
    const [msg] = buildDocumentSummaryPrompt("the document body");
    expect(msg.role).toBe("user");
    expect(msg.content).toContain("document");
    expect(msg.content).not.toContain("audio recording");
    expect(msg.content).toContain("the document body");
  });
  it("keeps the no-em-dashes instruction", () => {
    const [msg] = buildDocumentSummaryPrompt("x");
    expect(msg.content).toContain("Do not use em dashes");
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
    const text = buildLinkedInPrompt("TRANSCRIPT", DETAILS, ["EX_ONE"])[0].content;
    expect(text).toContain("Key takeaways from the session:");
    expect(text).toContain("Our sincere thanks to");
    expect(text).toContain("#Topic");
    expect(text.toLowerCase()).not.toContain("hashtag#");
    expect(text.toLowerCase()).toContain("no sign-off");
    expect(text).toContain("em dashes");
    expect(text).toContain("Tom Leighton");
    expect(text).toContain("Akamai Technologies");
    expect(text).toContain("TRANSCRIPT");
    expect(text).toContain("EX_ONE");
  });
});

describe("buildArticlePrompt", () => {
  it("caps length and asks for SEO structure and takeaways", () => {
    const text = buildArticlePrompt("TRANSCRIPT", DETAILS, ["EX_ONE"])[0].content;
    expect(text).toContain("1000 words");
    expect(text.toLowerCase()).toContain("seo");
    expect(text.toLowerCase()).toContain("key takeaways");
    expect(text).toContain("**Header**");
    expect(text).toContain("TRANSCRIPT");
    expect(text).toContain("EX_ONE");
  });
});

describe("buildSelectionRewritePrompt", () => {
  it("includes the selection, full draft, and format rules", () => {
    const text = buildSelectionRewritePrompt("linkedin", "FULL DRAFT", "THE SPAN", DETAILS, ["EX_ONE"])[0].content;
    expect(text).toContain("THE SPAN");
    expect(text).toContain("FULL DRAFT");
    expect(text).toContain("#Topic");
    expect(text).toContain("EX_ONE");
  });
  it("uses bold-header rule for article", () => {
    const text = buildSelectionRewritePrompt("article", "FULL", "SPAN", DETAILS, [])[0].content;
    expect(text).toContain("**Header**");
  });
});

describe("docBaseName", () => {
  it("strips a trailing media extension", () => {
    expect(docBaseName("recording.m4a")).toBe("recording");
    expect(docBaseName("Team Sync.mp3")).toBe("Team Sync");
    expect(docBaseName("clip.MP4")).toBe("clip");
  });
  it("leaves unrecognized extensions unchanged", () => {
    expect(docBaseName("talk.mp3.bak")).toBe("talk.mp3.bak");
    expect(docBaseName("plain")).toBe("plain");
  });
});

describe("docBaseName over documents", () => {
  it("strips document extensions so the doc is not named report.pdf", () => {
    expect(docBaseName("report.pdf")).toBe("report");
    expect(docBaseName("Board Pack.docx")).toBe("Board Pack");
    expect(docBaseName("deck.pptx")).toBe("deck");
  });
  it("still strips media extensions", () => {
    expect(docBaseName("talk.mp3")).toBe("talk");
  });
  it("still leaves unknown extensions alone", () => {
    expect(docBaseName("talk.mp3.bak")).toBe("talk.mp3.bak");
  });
});
