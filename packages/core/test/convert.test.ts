// packages/core/test/convert.test.ts
import { describe, it, expect } from "vitest";
import {
  sanitizeMp3Filename,
  sanitizeAudioFilename,
  defaultNameFromSource,
  ytDlpTitleArgs,
  ytDlpExtractArgs,
  ffmpegMp3Args,
} from "../src/convert.js";

describe("sanitizeMp3Filename", () => {
  it("adds a single .mp3 extension", () => {
    expect(sanitizeMp3Filename("talk")).toBe("talk.mp3");
  });
  it("does not double the extension", () => {
    expect(sanitizeMp3Filename("talk.mp3")).toBe("talk.mp3");
  });
  it("strips path separators and unsafe characters", () => {
    expect(sanitizeMp3Filename("../a/b:c*?.mp3")).toBe("a_b_c.mp3");
  });
  it("collapses whitespace and trims", () => {
    expect(sanitizeMp3Filename("  my   talk  ")).toBe("my_talk.mp3");
  });
  it("falls back to audio.mp3 when empty after sanitize", () => {
    expect(sanitizeMp3Filename("///")).toBe("audio.mp3");
  });
  it("caps the base length at 120 chars", () => {
    const long = "x".repeat(200);
    const out = sanitizeMp3Filename(long);
    expect(out.endsWith(".mp3")).toBe(true);
    expect(out.length).toBe(124); // 120 + ".mp3"
  });
});

describe("sanitizeAudioFilename", () => {
  it("adds the requested extension", () => {
    expect(sanitizeAudioFilename("talk", "wav")).toBe("talk.wav");
    expect(sanitizeAudioFilename("talk", "m4a")).toBe("talk.m4a");
    expect(sanitizeAudioFilename("talk", "mp3")).toBe("talk.mp3");
  });
  it("does not double an existing matching extension", () => {
    expect(sanitizeAudioFilename("talk.wav", "wav")).toBe("talk.wav");
  });
  it("swaps a mismatched extension for the requested one", () => {
    expect(sanitizeAudioFilename("talk.mp3", "wav")).toBe("talk.wav");
  });
  it("falls back to audio when empty after sanitize", () => {
    expect(sanitizeAudioFilename("///", "m4a")).toBe("audio.m4a");
  });
});

describe("defaultNameFromSource", () => {
  it("strips a trailing extension", () => {
    expect(defaultNameFromSource("keynote.mov")).toBe("keynote");
  });
  it("sanitizes unsafe characters", () => {
    expect(defaultNameFromSource("a b/c.mp4")).toBe("a_b_c");
  });
  it("returns audio for an empty name", () => {
    expect(defaultNameFromSource("")).toBe("audio");
  });
});

describe("ytDlpTitleArgs", () => {
  it("prints the title for the url", () => {
    expect(ytDlpTitleArgs("https://x/y")).toEqual([
      "--no-playlist", "--print", "title", "https://x/y",
    ]);
  });
});

describe("ytDlpExtractArgs", () => {
  it("extracts a 192k mp3 to the given stem using the bundled ffmpeg, defaulting to mp3", () => {
    expect(ytDlpExtractArgs("https://x/y", "/tmp/abc/out", "/opt/ff/bin")).toEqual([
      "--no-playlist", "-x", "--audio-format", "mp3", "--audio-quality", "192K",
      "--ffmpeg-location", "/opt/ff/bin",
      "-o", "/tmp/abc/out.%(ext)s", "https://x/y",
    ]);
  });
  it("extracts to a requested format", () => {
    expect(ytDlpExtractArgs("https://x/y", "/tmp/abc/out", "/opt/ff/bin", "wav")).toEqual([
      "--no-playlist", "-x", "--audio-format", "wav", "--audio-quality", "192K",
      "--ffmpeg-location", "/opt/ff/bin",
      "-o", "/tmp/abc/out.%(ext)s", "https://x/y",
    ]);
  });
});

describe("ffmpegMp3Args", () => {
  it("strips video and encodes 192k mp3, overwriting", () => {
    expect(ffmpegMp3Args("/tmp/in.mov", "/tmp/out.mp3")).toEqual([
      "-y", "-i", "/tmp/in.mov", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "/tmp/out.mp3",
    ]);
  });
});
