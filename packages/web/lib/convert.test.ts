import { describe, it, expect } from "vitest";
import { ytDlpCandidates, resolveExisting, sanitizeConvertId } from "./convert";

describe("ytDlpCandidates", () => {
  it("puts an explicit override first", () => {
    const c = ytDlpCandidates({ EE_YTDLP_PATH: "/opt/yt-dlp" }, "darwin");
    expect(c[0]).toBe("/opt/yt-dlp");
  });
  it("includes the managed bin path from EE_BIN_DIR", () => {
    const c = ytDlpCandidates({ EE_BIN_DIR: "/data/bin" }, "darwin");
    expect(c).toContain("/data/bin/yt-dlp");
  });
  it("uses yt-dlp.exe on win32", () => {
    const c = ytDlpCandidates({ EE_BIN_DIR: "C:/data/bin" }, "win32");
    expect(c).toContain("C:/data/bin/yt-dlp.exe");
  });
  it("includes a common homebrew install path", () => {
    const c = ytDlpCandidates({}, "darwin");
    expect(c).toContain("/opt/homebrew/bin/yt-dlp");
  });
  it("contains only real paths (no bare-name fallback)", () => {
    const c = ytDlpCandidates({}, "darwin");
    expect(c.every((p) => p.includes("/"))).toBe(true);
  });
});

describe("resolveExisting", () => {
  it("returns the first existing candidate", () => {
    expect(resolveExisting(["/a", "/b", "/c"], (p) => p === "/b")).toBe("/b");
  });
  it("returns null when none exist", () => {
    expect(resolveExisting(["/a", "/b"], () => false)).toBe(null);
  });
});

describe("sanitizeConvertId", () => {
  it("strips characters outside the id alphabet", () => {
    expect(sanitizeConvertId("../ab-9_x")).toBe("ab-9_x");
  });
});
