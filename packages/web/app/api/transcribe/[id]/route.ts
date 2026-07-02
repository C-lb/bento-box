import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { transcriptions } from "@event-editor/core/schema";
import { isLiked } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().select().from(transcriptions).where(eq(transcriptions.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    transcription: {
      id: row.id,
      originalFilename: row.originalFilename,
      status: row.status,
      durationSec: row.durationSec,
      summaryText: row.summaryText,
      docUrl: row.docUrl,
      errorMessage: row.errorMessage,
      transcriptText: row.transcriptText,
      hasContext: !!row.contextText,
      eventDetails: row.eventDetails ? JSON.parse(row.eventDetails) : null,
      summaryLinkedin: row.summaryLinkedin,
      summaryArticle: row.summaryArticle,
      likedLinkedin: !!row.summaryLinkedin && isLiked(getDb(), "linkedin", row.summaryLinkedin),
      likedArticle: !!row.summaryArticle && isLiked(getDb(), "article", row.summaryArticle),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  const db = getDb();
  db.delete(transcriptions).where(eq(transcriptions.id, nid)).run();
  // Best-effort cleanup of the upload dir; ignore if absent.
  await rm(resolve("data/uploads", String(nid)), { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
