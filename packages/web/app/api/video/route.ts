import { NextResponse } from "next/server";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { crfForPreset, videoOutName, type VideoPreset, type VideoScale } from "@event-editor/core/video";
import { compressVideo } from "@/lib/video";
import { guardUpload } from "@/lib/upload-guard";

export const runtime = "nodejs";

const PRESETS: VideoPreset[] = ["smaller", "balanced", "quality"];
const SCALES: VideoScale[] = ["keep", "1080", "720"];

export async function POST(request: Request) {
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const presetRaw = form.get("preset");
  const preset: VideoPreset = PRESETS.includes(presetRaw as VideoPreset) ? (presetRaw as VideoPreset) : "balanced";
  const scaleRaw = form.get("scale");
  const scale: VideoScale = SCALES.includes(scaleRaw as VideoScale) ? (scaleRaw as VideoScale) : "keep";

  const id = newJobId();
  const dir = jobDir("video", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("video", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const inBuf = Buffer.from(await file.arrayBuffer());
    const source = resolve(dir, "source");
    await writeFile(source, inBuf);
    const outPath = resolve(dir, "out.mp4");
    await compressVideo(source, outPath, { crf: crfForPreset(preset), scale });
    const outStat = await stat(outPath);
    return NextResponse.json({
      id,
      filename: videoOutName(file.name || "video"),
      bytesIn: inBuf.length,
      bytesOut: outStat.size,
    });
  } catch (err) {
    try { await cleanupJob("video", id); } catch { /* best-effort */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
