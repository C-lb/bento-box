import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { normalizeResizeOpts, resizeOutName } from "@event-editor/core/resize";
import { resizeImage } from "@/lib/resize";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const opts = normalizeResizeOpts({
    maxW: form.get("maxW"),
    maxH: form.get("maxH"),
    format: typeof form.get("format") === "string" ? String(form.get("format")) : undefined,
    quality: form.get("quality"),
  });

  const id = newJobId();
  const dir = jobDir("resize", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("resize", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const inBuf = Buffer.from(await file.arrayBuffer());
    const { data, ext } = await resizeImage(inBuf, opts, file.name || "image");
    await writeFile(resolve(dir, `out.${ext}`), data);
    return NextResponse.json({
      id,
      filename: resizeOutName(file.name || "image", opts.format, ext),
      ext,
      bytesIn: inBuf.length,
      bytesOut: data.length,
    });
  } catch (err) {
    try { await cleanupJob("resize", id); } catch { /* best-effort */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
