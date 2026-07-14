import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { validateClips, spliceOutName, type Clip, type SpliceKind, type SpliceScale } from "@event-editor/core/splice";
import { spliceClips } from "@/lib/splice";
import { guardUpload } from "@/lib/upload-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Add at least one clip" }, { status: 400 });

  let manifest: { kind: SpliceKind; scale: SpliceScale; clips: Clip[] };
  try {
    manifest = JSON.parse(String(form.get("manifest") ?? ""));
    validateClips(manifest.clips);
    if (manifest.clips.length !== files.length) throw new Error("Clip settings do not match the files");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Bad request" }, { status: 400 });
  }
  const kind: SpliceKind = manifest.kind === "audio" ? "audio" : "video";
  const scale: SpliceScale = manifest.scale === "1080" || manifest.scale === "720" ? manifest.scale : "match";
  const ext = kind === "video" ? "mp4" : "m4a";

  const id = newJobId();
  const dir = jobDir("splice", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("splice", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const inPaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const p = resolve(dir, `source-${i}`);
      await writeFile(p, Buffer.from(await files[i].arrayBuffer()));
      inPaths.push(p);
    }
    await spliceClips(inPaths, resolve(dir, `out.${ext}`), manifest.clips, { kind, scale });
    return NextResponse.json({ id, filename: spliceOutName(kind), kind });
  } catch (err) {
    try { await cleanupJob("splice", id); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
