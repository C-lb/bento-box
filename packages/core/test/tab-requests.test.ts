import { describe, it, expect } from "vitest";
import { buildTabRequests, type DocSection, type TabRequest } from "../src/transcribe.js";

// A tiny model of a Google Doc tab: text plus the ranges marked as headings.
// Running the real requests through this is what makes the test falsifiable.
// Asserting on the request literals instead would just restate the code.
function applyRequests(requests: TabRequest[], tabId: string) {
  let text = "";
  const headings: string[] = [];
  for (const req of requests) {
    if (req.insertText) {
      expect(req.insertText.location.tabId).toBe(tabId);
      const at = req.insertText.location.index - 1; // body content starts at index 1
      text = text.slice(0, at) + req.insertText.text + text.slice(at);
    } else if (req.updateParagraphStyle) {
      const r = req.updateParagraphStyle.range;
      expect(r.tabId).toBe(tabId);
      expect(req.updateParagraphStyle.paragraphStyle.namedStyleType).toBe("HEADING_1");
      headings.push(text.slice(r.startIndex - 1, r.endIndex - 1));
    }
  }
  return { text, headings };
}

const sections: DocSection[] = [
  { heading: "Summary", body: { kind: "paras", text: "first para\n\nsecond para" } },
  { heading: "LinkedIn post", body: { kind: "paras", text: "the post" } },
];

describe("buildTabRequests", () => {
  it("produces a tab whose text is the sections in order", () => {
    const { text } = applyRequests(buildTabRequests(sections, "t.1"), "t.1");
    expect(text).toBe(
      "Summary\nfirst para\nsecond para\nLinkedIn post\nthe post\n",
    );
  });

  it("marks exactly the heading paragraphs as headings", () => {
    const { headings } = applyRequests(buildTabRequests(sections, "t.1"), "t.1");
    expect(headings).toEqual(["Summary\n", "LinkedIn post\n"]);
  });

  it("keeps heading ranges correct when a body has many paragraphs", () => {
    const many: DocSection[] = [
      { heading: "Summary", body: { kind: "paras", text: "a\n\nb\n\nc\n\nd" } },
      { heading: "Article", body: { kind: "paras", text: "e" } },
    ];
    const { headings } = applyRequests(buildTabRequests(many, "t.2"), "t.2");
    expect(headings).toEqual(["Summary\n", "Article\n"]);
  });

  it("renders timestamped segments", () => {
    const s: DocSection[] = [
      { heading: "Transcript", body: { kind: "segments", segments: [{ startSec: 0, text: "hi" }, { startSec: 61, text: "there" }] } },
    ];
    const { text } = applyRequests(buildTabRequests(s, "t.3"), "t.3");
    expect(text).toBe("Transcript\n[00:00:00] hi\n[00:01:01] there\n");
  });

  it("emits no requests for no sections", () => {
    expect(buildTabRequests([], "t.4")).toEqual([]);
  });
});
