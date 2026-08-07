import { describe, it, expect } from "vitest";
import {
  documentExtFromName,
  extractDocumentText,
  MAX_DOC_CHARS,
} from "@/lib/context";

describe("documentExtFromName", () => {
  it("accepts the document formats", () => {
    expect(documentExtFromName("notes.txt")).toBe("txt");
    expect(documentExtFromName("Board Pack.DOCX")).toBe("docx");
    expect(documentExtFromName("deck.pptx")).toBe("pptx");
    expect(documentExtFromName("report.pdf")).toBe("pdf");
  });
  it("rejects everything else", () => {
    expect(documentExtFromName("talk.mp3")).toBeNull();
    expect(documentExtFromName("noextension")).toBeNull();
  });
});

describe("extractDocumentText", () => {
  it("reads plain text and strips markup from markdown", async () => {
    const md = Buffer.from("# Title\n\nSome **bold** text");
    expect(await extractDocumentText(md, "markdown")).toBe("Title\n\nSome bold text");
  });

  it("rejects a document with no extractable text", async () => {
    await expect(extractDocumentText(Buffer.from("   \n  "), "txt")).rejects.toThrow(
      /No text found/i,
    );
  });

  it("rejects a document over the size cap rather than truncating", async () => {
    const huge = Buffer.from("a".repeat(MAX_DOC_CHARS + 1));
    await expect(extractDocumentText(huge, "txt")).rejects.toThrow(/too long/i);
  });

  it("accepts a document exactly at the cap", async () => {
    const atCap = Buffer.from("a".repeat(MAX_DOC_CHARS));
    expect((await extractDocumentText(atCap, "txt")).length).toBe(MAX_DOC_CHARS);
  });
});
