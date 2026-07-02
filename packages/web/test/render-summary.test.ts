import { describe, it, expect } from "vitest";
import { summaryToHtml, summaryToPlain } from "../lib/render-summary";

describe("summaryToHtml", () => {
  it("bolds ** headers instead of showing markers", () => {
    const html = summaryToHtml("**Key takeaways:**\nDistributed intelligence matters.");
    expect(html).toContain("<strong>Key takeaways:</strong>");
    expect(html).not.toContain("**");
  });

  it("bolds legacy # headers and drops the number sign", () => {
    const html = summaryToHtml("## Section title\nBody line.");
    expect(html).toContain("Section title");
    expect(html).not.toContain("#");
  });

  it("leaves #AI hashtags alone (no space after #)", () => {
    const html = summaryToHtml("#AI #EnterpriseAI");
    expect(html).toContain("#AI");
    expect(html).toContain("#EnterpriseAI");
  });

  it("escapes HTML in the source text", () => {
    expect(summaryToHtml("a <b> & c")).toContain("a &lt;b&gt; &amp; c");
  });
});

describe("summaryToPlain", () => {
  it("strips ** and leading # markers but keeps hashtags", () => {
    const plain = summaryToPlain("## Section\n**Bold** and #AI");
    expect(plain).toBe("Section\nBold and #AI");
  });
});
