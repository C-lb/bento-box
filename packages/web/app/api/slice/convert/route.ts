import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { newRunId, runDir, deckPath, masterPdfPath, cleanupRun, sweepOldRuns } from "@/lib/slice";
import { convertToPdf, readSlides, findSoffice } from "@/lib/pptx-convert";
import { pdfPageCount } from "@/lib/pdf-slice";
import { getDb } from "@/lib/db";
import { createSliceRun } from "@event-editor/core/slice-runs";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

function safeName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "deck";
  return base.toLowerCase().endsWith(".pptx") ? base : `${base}.pptx`;
}

export async function POST(request: Request) {
  if (!findSoffice()) {
    return NextResponse.json({ error: "LibreOffice is not installed. See the tool page for install steps." }, { status: 400 });
  }

  // Validate everything cheap BEFORE creating the run dir, so early 400s never leak a dir.
  const ct = request.headers.get("content-type") ?? "";
  let driveFileId: string | null = null;
  let filename = "deck.pptx";
  if (ct.includes("application/json")) {
    const body = (await request.json()) as { driveFileId?: string };
    driveFileId = body?.driveFileId ?? null;
    if (!driveFileId) return NextResponse.json({ error: "driveFileId required" }, { status: 400 });
  } else {
    const raw = request.headers.get("x-filename");
    if (!raw) return NextResponse.json({ error: "x-filename header required" }, { status: 400 });
    if (!request.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
    filename = safeName(raw);
  }

  // Drive connection is a validation too, check it before we create anything.
  let drive: Awaited<ReturnType<typeof authedDriveClient>> = null;
  if (driveFileId) {
    drive = await authedDriveClient(getDb());
    if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
  }

  const runId = newRunId();
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  try { await sweepOldRuns(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  const pptx = deckPath(runId);

  try {
    if (driveFileId) {
      const bytes = await makeDriveClient(drive!).downloadFile(driveFileId);
      await writeFile(pptx, bytes);
    } else {
      await pipeline(Readable.fromWeb(request.body as any), createWriteStream(pptx));
    }

    await convertToPdf(pptx, dir);
    const slides = await readSlides(pptx);
    const pageCount = await pdfPageCount(await readFile(masterPdfPath(runId)));

    const warnings: string[] = [];
    if (slides.length !== pageCount) {
      warnings.push(`This deck has ${slides.length} slides but the PDF has ${pageCount} pages, so slide numbers may not line up with page numbers. Double-check your ranges.`);
    }
    createSliceRun(getDb(), { runId, sourceFilename: filename });
    return NextResponse.json({ runId, pageCount, slides, filename, warnings });
  } catch (err) {
    try { await cleanupRun(runId); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
