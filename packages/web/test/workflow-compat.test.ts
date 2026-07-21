import { describe, it, expect } from "vitest";
import { canFollow, isChainable, kindsFor, compatibleNextTools, CHAINABLE_KINDS } from "../lib/workflow/compat.js";

describe("workflow step-kind compatibility", () => {
  it("declares exactly the 12 chainable tools from the spec", () => {
    const ids = CHAINABLE_KINDS.map((k) => k.toolId).sort();
    expect(ids).toEqual(
      ["convert", "heic", "pdf", "qr", "resize", "shorten", "slice", "sorter", "splice", "studio", "transcribe", "video"].sort(),
    );
  });

  it("allows file -> file adjacency (resize -> convert)", () => {
    expect(canFollow("file", "file")).toBe(true);
  });

  it("allows files -> file (splice consumes files, outputs file)", () => {
    expect(canFollow("files", "file")).toBe(false); // splice outputKind is file, not files-in
  });

  it("rejects mismatched kinds (file -> url-text)", () => {
    expect(canFollow("file", "url-text")).toBe(false);
  });

  it("rejects any adjacency into a 'none' input kind", () => {
    expect(canFollow("file", "none")).toBe(false);
    expect(canFollow("drive-ranked-list", "none")).toBe(false);
  });

  it("kindsFor returns the declared kinds for slice and qr", () => {
    expect(kindsFor("slice")).toEqual({ toolId: "slice", inputKind: "file", outputKind: "files" });
    expect(kindsFor("qr")).toEqual({ toolId: "qr", inputKind: "url-text", outputKind: "file" });
  });

  it("isChainable is false for non-chainable tools", () => {
    expect(isChainable("cutout")).toBe(false);
    expect(isChainable("certificate")).toBe(false);
    expect(isChainable("badge")).toBe(false);
    expect(isChainable("place-card")).toBe(false);
    expect(isChainable("ticket")).toBe(false);
    expect(isChainable("resize")).toBe(true);
  });

  it("compatibleNextTools returns everything chainable for an empty chain", () => {
    expect(compatibleNextTools(null)).toHaveLength(12);
  });

  it("compatibleNextTools filters by the prior step's outputKind", () => {
    const next = compatibleNextTools("file"); // resize/heic/convert/video output file; pdf/splice too; slice outputs files
    const ids = next.map((k) => k.toolId).sort();
    expect(ids).toEqual(["convert", "heic", "pdf", "resize", "slice", "transcribe", "video"].sort());
  });

  it("compatibleNextTools returns nothing after sorter/transcribe/studio outputs (no consumer today)", () => {
    expect(compatibleNextTools("drive-ranked-list")).toEqual([]);
    expect(compatibleNextTools("doc")).toEqual([]);
    expect(compatibleNextTools("headshot-batch")).toEqual([]);
  });
});
