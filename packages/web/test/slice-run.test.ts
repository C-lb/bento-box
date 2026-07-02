import { describe, it, expect } from "vitest";
import { sanitizeRunId, newRunId, runDir, masterPdfPath, deckPath, outDir } from "../lib/slice";

describe("slice run helpers", () => {
  it("strips path traversal and unsafe chars from run ids", () => {
    expect(sanitizeRunId("../../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeRunId("abc-123_XY")).toBe("abc-123_XY");
  });
  it("builds paths under data/slice/<runId>", () => {
    expect(runDir("r1").endsWith("data/slice/r1")).toBe(true);
    expect(deckPath("r1").endsWith("data/slice/r1/deck.pptx")).toBe(true);
    expect(masterPdfPath("r1").endsWith("data/slice/r1/deck.pdf")).toBe(true);
    expect(outDir("r1").endsWith("data/slice/r1/out")).toBe(true);
  });
  it("generates unique-ish run ids", () => {
    expect(newRunId()).not.toBe(newRunId());
  });
});
