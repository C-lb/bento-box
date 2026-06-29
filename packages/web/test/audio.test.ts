import { describe, it, expect } from "vitest";
import { segmentArgs } from "../lib/audio";

describe("segmentArgs", () => {
  it("builds ffmpeg args for 16kHz mono mp3 segmenting", () => {
    const args = segmentArgs("/in/talk.m4a", "/out/chunk_%03d.mp3", 600);
    expect(args).toEqual([
      "-i", "/in/talk.m4a",
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-f", "segment",
      "-segment_time", "600",
      "-c:a", "libmp3lame",
      "-q:a", "5",
      "/out/chunk_%03d.mp3",
    ]);
  });
});
