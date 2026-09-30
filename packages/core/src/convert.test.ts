import { describe, it, expect } from "vitest";
import { audioArgs, ytDlpBaseArgs } from "./convert";

describe("audioArgs", () => {
  it("mp3 uses libmp3lame at 192k", () => {
    expect(audioArgs("in", "out.mp3", "mp3")).toEqual(
      ["-y", "-i", "in", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "out.mp3"],
    );
  });
  it("wav uses pcm_s16le", () => {
    expect(audioArgs("in", "out.wav", "wav")).toEqual(
      ["-y", "-i", "in", "-vn", "-c:a", "pcm_s16le", "out.wav"],
    );
  });
  it("m4a uses aac at 192k", () => {
    expect(audioArgs("in", "out.m4a", "m4a")).toEqual(
      ["-y", "-i", "in", "-vn", "-c:a", "aac", "-b:a", "192k", "out.m4a"],
    );
  });
});

describe("ytDlpBaseArgs", () => {
  it("always suppresses the self-update nag", () => {
    expect(ytDlpBaseArgs()).toEqual(["--no-update"]);
  });
  it("points yt-dlp at deno when a runtime path is known", () => {
    expect(ytDlpBaseArgs({ jsRuntimePath: "/opt/homebrew/bin/deno" }))
      .toEqual(["--no-update", "--js-runtimes", "deno:/opt/homebrew/bin/deno"]);
  });
  it("adds browser cookies only when asked", () => {
    expect(ytDlpBaseArgs({ cookiesBrowser: "chrome" })).toContain("--cookies-from-browser");
    expect(ytDlpBaseArgs({ cookiesBrowser: null })).not.toContain("--cookies-from-browser");
  });
});
