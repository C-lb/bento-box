import { describe, it, expect } from "vitest";
import { ytDlpAsset, ytDlpDownloadUrl, parseSha256Sum } from "./deps";

describe("ytDlpAsset", () => {
  it("maps darwin to the macos build", () => {
    expect(ytDlpAsset("darwin")).toBe("yt-dlp_macos");
  });
  it("maps win32 to the exe", () => {
    expect(ytDlpAsset("win32")).toBe("yt-dlp.exe");
  });
  it("defaults to the linux build", () => {
    expect(ytDlpAsset("linux")).toBe("yt-dlp_linux");
  });
});

describe("ytDlpDownloadUrl", () => {
  it("points at the latest release asset", () => {
    expect(ytDlpDownloadUrl("darwin")).toBe(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
    );
  });
});

describe("parseSha256Sum", () => {
  const sums = [
    "0000000000000000000000000000000000000000000000000000000000000000  yt-dlp",
    "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd  yt-dlp_macos",
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  yt-dlp.exe",
  ].join("\n");

  it("returns the hash for the matching asset", () => {
    expect(parseSha256Sum(sums, "yt-dlp_macos")).toBe(
      "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
    );
  });
  it("lowercases the hash", () => {
    expect(parseSha256Sum("ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABC123ABCD  yt-dlp", "yt-dlp"))
      .toBe("abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd");
  });
  it("does not match a filename that is a prefix of another", () => {
    expect(parseSha256Sum(sums, "yt-dlp")).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });
  it("returns null when the asset is absent", () => {
    expect(parseSha256Sum(sums, "yt-dlp_linux")).toBe(null);
  });
  it("returns null for malformed input", () => {
    expect(parseSha256Sum("not a checksums file", "yt-dlp")).toBe(null);
  });
});
