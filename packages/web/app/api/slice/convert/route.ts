import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { newRunId, runDir, deckPath, masterPdfPath } from "@/lib/slice";
import { convertToPdf, readSlides, findSoffice } from "@/lib/pptx-convert";
import { pdfPageCount } from "@/lib/pdf-slice";
import { getDb } from "@/lib/db";
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

  const runId = newRunId();
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  const pptx = deckPath(runId);
  let filename = "deck.pptx";

  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const { driveFileId } = await request.json();
      if (!driveFileId) return NextResponse.json({ error: "driveFileId required" }, { status: 400 });
      const drive = await authedDriveClient(getDb());
      if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
      const bytes = await makeDriveClient(drive).downloadFile(driveFileId);
      await writeFile(pptx, bytes);
      filename = "deck.pptx";
    } else {
      const raw = request.headers.get("x-filename");
      if (!raw) return NextResponse.json({ error: "x-filename header required" }, { status: 400 });
      if (!request.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
      filename = safeName(raw);
      await pipeline(Readable.fromWeb(request.body as any), createWriteStream(pptx));
    }

    await convertToPdf(pptx, dir);
    const slides = await readSlides(pptx);
    const pageCount = await pdfPageCount(await readFile(masterPdfPath(runId)));

    return NextResponse.json({ runId, pageCount, slides, filename });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
