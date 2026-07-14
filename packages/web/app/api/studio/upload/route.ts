import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, sweepOldJobs } from "@/lib/jobs";

export const runtime = "nodejs";

// Accepts a local image for the Headshot Studio when Drive isn't the source.
// Bytes are stashed under data/studio-upload/<id>/src and handed to the render
// pipeline via an opaque id, so no filesystem path ever crosses the client.
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "An image file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "That file is not an image" }, { status: 400 });
  }

  const id = newJobId();
  const dir = jobDir("studio-upload", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("studio-upload", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }

  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(resolve(dir, "src"), bytes);
  return NextResponse.json({ uploadId: id, filename: file.name || "upload" });
}
