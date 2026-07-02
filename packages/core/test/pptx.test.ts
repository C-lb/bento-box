import { describe, it, expect } from "vitest";
import {
  slideTextFromXml,
  slideNumberFromPath,
  orderSlidePaths,
  buildSpeakerSegmentPrompt,
  buildTopicSegmentPrompt,
  normalizeSpeakerGroups,
} from "../src/pptx.js";

describe("slideTextFromXml", () => {
  it("joins a:t runs and decodes entities", () => {
    const xml = `<p:sld><a:t>Welcome &amp; </a:t><a:t>Keynote</a:t></p:sld>`;
    expect(slideTextFromXml(xml)).toBe("Welcome & Keynote");
  });
  it("returns empty string when there is no text", () => {
    expect(slideTextFromXml("<p:sld/>")).toBe("");
  });
});

describe("slideNumberFromPath / orderSlidePaths", () => {
  it("extracts the slide index", () => {
    expect(slideNumberFromPath("ppt/slides/slide12.xml")).toBe(12);
    expect(slideNumberFromPath("ppt/slides/_rels/slide1.xml.rels")).toBe(null);
  });
  it("orders numerically, not lexically", () => {
    expect(orderSlidePaths(["ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slides/slide1.xml"]))
      .toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml"]);
  });
});

describe("buildSpeakerSegmentPrompt", () => {
  it("includes slide markers and both text and notes", () => {
    const p = buildSpeakerSegmentPrompt([
      { index: 1, text: "Intro by Ada", notes: "Ada speaking" },
      { index: 2, text: "Deep dive", notes: "" },
    ]);
    expect(p).toContain("Slide 1");
    expect(p).toContain("Intro by Ada");
    expect(p).toContain("Ada speaking");
    expect(p).toContain("Slide 2");
  });
});

describe("normalizeSpeakerGroups", () => {
  it("clamps, orders, swaps reversed bounds, and names blanks", () => {
    const out = normalizeSpeakerGroups(
      [
        { speaker: "", startSlide: 8, endSlide: 4 },
        { speaker: "Ada", startSlide: 0, endSlide: 2 },
      ],
      5,
    );
    expect(out).toEqual([
      { speaker: "Ada", startSlide: 1, endSlide: 2 },
      { speaker: "Speaker 2", startSlide: 4, endSlide: 5 },
    ]);
  });
});

describe("buildTopicSegmentPrompt", () => {
  it("frames topics, states the slide count, and includes slide bodies and notes", () => {
    const slides = [
      { index: 1, text: "Welcome", notes: "" },
      { index: 2, text: "Revenue", notes: "up 20%" },
    ];
    const p = buildTopicSegmentPrompt(slides);
    expect(p).toContain("topic sections");
    expect(p).toContain("covering slides 1 to 2");
    expect(p).toContain("Slide 1: Welcome");
    expect(p).toContain("Notes: up 20%");
  });
});

describe("normalizeSpeakerGroups labelPrefix", () => {
  it("names blank labels with the supplied prefix", () => {
    const out = normalizeSpeakerGroups([{ speaker: "", startSlide: 1, endSlide: 2 }], 3, "Section");
    expect(out[0].speaker).toBe("Section 1");
  });
});
