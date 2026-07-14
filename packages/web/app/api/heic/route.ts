import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { normalizeHeicOpts, heicOutName } from "@event-editor/core/heic";
import { recordHeicConversion } from "@event-editor/core/heic-history";
import { getDb } from "@/lib/db";
import { heicToImage } from "@/lib/heic";
import { guardUpload } from "@/lib/upload-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const num = (k: string) => (form.get(k) != null ? Number(form.get(k)) : undefined);
  const opts = normalizeHeicOpts({
    format: typeof form.get("format") === "string" ? String(form.get("format")) : undefined,
    quality: num("quality"),
    saturation: num("saturation"),
    brightness: num("brightness"),
    haze: num("haze"),
  });
  const filename = heicOutName(file.name || "image", opts.format);
  const batchId = typeof form.get("batchId") === "string" ? String(form.get("batchId")) : newJobId();

  const id = newJobId();
  const dir = jobDir("heic", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("heic", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const out = await heicToImage(buf, opts);
    await writeFile(resolve(dir, `out.${opts.format}`), out);
    try {
      recordHeicConversion(getDb(), {
        batchId,
        jobId: id,
        sourceFilename: file.name || "image",
        outFilename: filename,
        outFormat: opts.format,
      });
    } catch { /* history is best-effort; never fail the conversion over it */ }
    return NextResponse.json({ id, filename, format: opts.format });
  } catch (err) {
    try { await cleanupJob("heic", id); } catch { /* best-effort */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
