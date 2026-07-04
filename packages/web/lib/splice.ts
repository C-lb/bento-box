import { run, ffmpegBin } from "@/lib/spawn";
import { ffmpegSpliceArgs, type Clip, type SpliceKind, type SpliceScale } from "@event-editor/core/splice";

export async function spliceClips(
  inPaths: string[],
  outPath: string,
  clips: Clip[],
  opts: { kind: SpliceKind; scale: SpliceScale },
): Promise<void> {
  await run(ffmpegBin(), ffmpegSpliceArgs(inPaths, outPath, clips, opts));
}
