import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newJobId, jobDir, sweepOldJobs } from "@/lib/jobs";
import { guardUpload } from "@/lib/upload-guard";

export const runtime = "nodejs";

// Re-running a saved workflow from /workflows needs a real FileRef ({path,
// filename}) for a "file"-kind first step, same shape every step adapter in
// lib/workflow/steps/* already consumes (see StepIO.ts). This mirrors the
// studio-upload route's pattern (stash bytes under a job dir via the shared
// jobs.ts helpers) but returns the on-disk path directly, because the
// existing /api/workflow/[id]/run contract already has the caller pass an
// arbitrary firstInput straight through as JSON (Task 10) — there's no
// opaque-id indirection to preserve there like there is for studio.
export async function POST(request: Request) {
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }

  const id = newJobId();
  const dir = jobDir("workflow-upload", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("workflow-upload", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }

  const filename = file.name || "upload";
  const path = join(dir, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path, bytes);

  return NextResponse.json({ path, filename });
}
