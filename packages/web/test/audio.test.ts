import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { describe, it, expect, afterAll } from "vitest";
import { segmentArgs, transcodeAndSegment } from "../lib/audio";

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

function synthesizeTone(out: string, seconds: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(ffmpegPath as string, [
      "-f", "lavfi",
      "-i", `sine=frequency=440:duration=${seconds}`,
      "-c:a", "libmp3lame",
      "-q:a", "9",
      out,
    ]);
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

describe("transcodeAndSegment", () => {
  it("never returns chunks left behind by a previous run in the same dir", async () => {
    // The packaged-app contamination bug: run 7's chunks dir pre-existed with
    // another recording's chunk_004..009, and the glob swept them into the new
    // transcript. Stale chunk files must not survive a new segmenting run.
    const dir = await mkdtemp(join(tmpdir(), "ee-audio-"));
    tmpDirs.push(dir);
    const source = join(dir, "source.mp3");
    await synthesizeTone(source, 2);

    const outDir = join(dir, "chunks");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "chunk_007.mp3"), "stale bytes from an old recording");

    const paths = await transcodeAndSegment(source, outDir, 60);

    expect(paths).toHaveLength(1);
    expect(paths[0].endsWith("chunk_000.mp3")).toBe(true);
    const left = await readdir(outDir);
    expect(left).not.toContain("chunk_007.mp3");
  }, 30000);
});

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
