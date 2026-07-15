import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

export function segmentArgs(input: string, outPattern: string, chunkSec: number): string[] {
  return [
    "-i", input,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-f", "segment",
    "-segment_time", String(chunkSec),
    "-c:a", "libmp3lame",
    "-q:a", "5",
    outPattern,
  ];
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function probeDuration(input: string): Promise<number> {
  const out = await run(ffprobeStatic.path, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    input,
  ]);
  const seconds = parseFloat(out.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

export async function transcodeAndSegment(input: string, outDir: string, chunkSec: number): Promise<string[]> {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found");
  // An upload literally named "chunks" would make outDir collide with the
  // source; the rm below would then delete the upload itself.
  if (resolve(outDir) === resolve(input)) throw new Error("chunk dir collides with the source file");
  // Start from an empty dir: the glob below sweeps every chunk_*.mp3, so any
  // file left by a previous run (retry, or a dir that pre-existed the upload)
  // would be transcribed into this recording's transcript.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await run(ffmpegPath, segmentArgs(input, join(outDir, "chunk_%03d.mp3"), chunkSec));
  const files = (await readdir(outDir)).filter((f) => f.startsWith("chunk_") && f.endsWith(".mp3")).sort();
  return files.map((f) => join(outDir, f));
}
