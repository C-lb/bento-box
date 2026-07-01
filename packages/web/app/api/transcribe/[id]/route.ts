import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
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
    },
  });
}
