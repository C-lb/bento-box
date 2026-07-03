import { describe, it, expect } from "vitest";
import { ytDlpAsset, ytDlpDownloadUrl } from "./deps";

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
