export type SpliceKind = "video" | "audio";
export type SpliceScale = "match" | "1080" | "720";
export type Clip = { start: number; end: number; volume: number };

export function validateClips(clips: Clip[]): void {
  if (!clips || clips.length === 0) throw new Error("Add at least one clip");
  for (const c of clips) {
    if (!(c.end > c.start)) throw new Error("Each clip's trim must end after it starts");
    if (c.volume < 0) throw new Error("Volume cannot be negative");
  }
}

// Build one filter_complex that trims (and for video, scales) each input, then
// concats them in order. The video and audio branches build their own concat
// tail directly (no post-hoc label rewriting) since ffmpeg's concat filter
// needs a different label sequence and stream count depending on whether
// video is present.
export function ffmpegSpliceArgs(
  inPaths: string[],
  outPath: string,
  clips: Clip[],
  opts: { kind: SpliceKind; scale: SpliceScale },
): string[] {
  validateClips(clips);
  const args: string[] = ["-y"];
  for (const p of inPaths) args.push("-i", p);

  const n = inPaths.length;
  const parts: string[] = [];
  const joinLabels: string[] = [];

  if (opts.kind === "video") {
    const scaleFilter = opts.scale === "match" ? "" : `,scale=-2:${opts.scale}`;
    for (let i = 0; i < n; i++) {
      const c = clips[i];
      parts.push(
        `[${i}:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS${scaleFilter}[v${i}]`,
      );
      parts.push(
        `[${i}:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,volume=${c.volume}[a${i}]`,
      );
      joinLabels.push(`[v${i}][a${i}]`);
    }
    parts.push(`${joinLabels.join("")}concat=n=${n}:v=1:a=1[outv][outa]`);
  } else {
    for (let i = 0; i < n; i++) {
      const c = clips[i];
      parts.push(
        `[${i}:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,volume=${c.volume}[a${i}]`,
      );
      joinLabels.push(`[a${i}]`);
    }
    parts.push(`${joinLabels.join("")}concat=n=${n}:v=0:a=1[outa]`);
  }

  args.push("-filter_complex", parts.join(";"));
  if (opts.kind === "video") {
    args.push("-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-preset", "medium", "-crf", "20");
    args.push("-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart");
  } else {
    args.push("-map", "[outa]", "-c:a", "aac", "-b:a", "192k");
  }
  args.push(outPath);
  return args;
}

export function spliceOutName(kind: SpliceKind): string {
  return kind === "video" ? "joined.mp4" : "joined.m4a";
}
