import { describe, it, expect } from "vitest";
import { crfForPreset, ffmpegCompressArgs, videoOutName } from "../src/video.js";

describe("crfForPreset", () => {
  it("maps presets to CRF", () => {
    expect(crfForPreset("smaller")).toBe(28);
    expect(crfForPreset("balanced")).toBe(23);
    expect(crfForPreset("quality")).toBe(20);
  });
});

describe("ffmpegCompressArgs", () => {
  it("builds an h264 + aac mp4 command with the given crf", () => {
    const a = ffmpegCompressArgs("in.mov", "out.mp4", { crf: 23, scale: "keep" });
    expect(a).toContain("-i");
    expect(a[a.indexOf("-i") + 1]).toBe("in.mov");
    expect(a).toContain("libx264");
    expect(a).toContain("23");
    expect(a).toContain("aac");
    expect(a[a.length - 1]).toBe("out.mp4");
    expect(a).toContain("-y");
    expect(a.join(" ")).not.toContain("scale="); // keep => no scale filter
  });
  it("adds a scale filter for 720", () => {
    const a = ffmpegCompressArgs("in.mp4", "out.mp4", { crf: 28, scale: "720" });
    expect(a.join(" ")).toContain("scale=-2:720");
  });
});

describe("videoOutName", () => {
  it("names the output mp4", () => {
    expect(videoOutName("Clip.MOV")).toBe("Clip-compressed.mp4");
  });
});
