import { safeBase } from "./names.js";

export type VideoPreset = "smaller" | "balanced" | "quality";
export type VideoScale = "keep" | "1080" | "720";

export function crfForPreset(p: VideoPreset): number {
  return p === "smaller" ? 28 : p === "quality" ? 20 : 23;
}

export function ffmpegCompressArgs(
  inPath: string,
  outPath: string,
  opts: { crf: number; scale: VideoScale },
): string[] {
  const args = ["-y", "-i", inPath];
  if (opts.scale !== "keep") {
    // -2 keeps the other dimension even, required by h264.
    args.push("-vf", `scale=-2:${opts.scale}`);
  }
  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", String(opts.crf),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  );
  return args;
}

export function videoOutName(srcName: string): string {
  const base = safeBase(srcName.replace(/\.[a-z0-9]+$/i, "")) || "video";
  return `${base}-compressed.mp4`;
}
