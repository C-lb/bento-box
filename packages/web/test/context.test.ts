import { describe, it, expect, vi } from "vitest";
import { extFromName, stripMarkup, parseContextFile, stashContext, readStash } from "../lib/context";

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

describe("stash round-trip", () => {
  it("stashes parsed text and reads it back", async () => {
    const id = await stashContext(Buffer.from("# Kept"), "md");
    const got = await readStash(id);
    expect(got?.ext).toBe("md");
    expect(got?.text).toContain("Kept");
  });
  it("returns null for an unknown id", async () => {
    expect(await readStash("does-not-exist")).toBeNull();
  });
});
