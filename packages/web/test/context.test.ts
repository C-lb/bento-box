import { describe, it, expect, vi } from "vitest";
import { extFromName, stripMarkup, parseContextFile } from "../lib/context";

describe("extFromName", () => {
  it("maps known extensions and rejects others", () => {
    expect(extFromName("agenda.PDF")).toBe("pdf");
    expect(extFromName("deck.pptx")).toBe("pptx");
    expect(extFromName("notes.md")).toBe("md");
    expect(extFromName("page.html")).toBe("html");
    expect(extFromName("audio.mp3")).toBeNull();
    expect(extFromName("noext")).toBeNull();
  });
});

describe("stripMarkup", () => {
  it("removes html tags, scripts, and decodes entities", () => {
    const out = stripMarkup("<style>x{}</style><h1>Hi &amp; bye</h1><p>Line</p>");
    expect(out).toContain("Hi & bye");
    expect(out).toContain("Line");
    expect(out).not.toContain("<h1>");
    expect(out).not.toContain("x{}");
  });
  it("strips common markdown markers", () => {
    const out = stripMarkup("# Title\n**bold** and _em_ and `code`");
    expect(out).toContain("Title");
    expect(out).toContain("bold");
    expect(out).not.toContain("**");
    expect(out).not.toContain("`");
  });
});

describe("parseContextFile", () => {
  it("parses md and html in-house", async () => {
    expect(await parseContextFile(Buffer.from("# Hello"), "md")).toContain("Hello");
    expect(await parseContextFile(Buffer.from("<p>Hello</p>"), "html")).toContain("Hello");
  });
});
