import { run, ffmpegBin } from "@/lib/spawn";
import { ffmpegCompressArgs, type VideoScale } from "@event-editor/core/video";

export async function compressVideo(
  inPath: string,
  outPath: string,
  opts: { crf: number; scale: VideoScale },
): Promise<void> {
  await run(ffmpegBin(), ffmpegCompressArgs(inPath, outPath, opts));
}
