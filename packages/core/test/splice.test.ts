import { describe, it, expect } from "vitest";
import { validateClips, ffmpegSpliceArgs, spliceOutName } from "../src/splice.js";

const clips = [
  { start: 0, end: 5, volume: 1 },
  { start: 2, end: 4, volume: 0 },
];

describe("validateClips", () => {
  it("rejects an empty list", () => {
    expect(() => validateClips([])).toThrow(/at least one/i);
  });
  it("rejects start >= end", () => {
    expect(() => validateClips([{ start: 3, end: 3, volume: 1 }])).toThrow(/trim/i);
  });
});

describe("ffmpegSpliceArgs (video)", () => {
  it("trims, scales, and concats each input", () => {
    const a = ffmpegSpliceArgs(["a.mp4", "b.mp4"], "out.mp4", clips, { kind: "video", scale: "720" });
    const s = a.join(" ");
    expect(a.filter((x) => x === "-i").length).toBe(2);
    expect(s).toContain("trim=start=0:end=5");
    expect(s).toContain("trim=start=2:end=4");
    expect(s).toContain("scale=-2:720");
    expect(s).toContain("volume=0"); // muted second clip
    expect(s).toContain("concat=n=2:v=1:a=1");
    expect(a[a.length - 1]).toBe("out.mp4");
  });
});

describe("ffmpegSpliceArgs (audio)", () => {
  it("uses atrim and audio-only concat", () => {
    const a = ffmpegSpliceArgs(["a.mp3", "b.mp3"], "out.m4a", clips, { kind: "audio", scale: "match" });
    const s = a.join(" ");
    expect(s).toContain("atrim=start=0:end=5");
    expect(s).toContain("concat=n=2:v=0:a=1");
    expect(s).not.toContain("scale=");
  });
});

describe("spliceOutName", () => {
  it("names by kind", () => {
    expect(spliceOutName("video")).toBe("joined.mp4");
    expect(spliceOutName("audio")).toBe("joined.m4a");
  });
});
