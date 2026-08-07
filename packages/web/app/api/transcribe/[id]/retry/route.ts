import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startTranscription } from "@/lib/transcriber";
import { startDocumentSummary } from "@/lib/document-runner";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.select().from(transcriptions).where(eq(transcriptions.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Document and gdoc rows never have an upload: their extracted text is
  // already in transcriptText, so a retry re-runs the summary pipeline from
  // there. Requiring sourceUploadPath here would dead-end the branch's own
  // flagship recovery path (403 for a missing documents scope -> reconnect ->
  // Try again).
  const kind = row.sourceKind ?? "audio";
  if (kind === "document" || kind === "gdoc") {
    if (!row.transcriptText?.trim()) {
      return NextResponse.json({ error: "no document text to retry" }, { status: 400 });
    }
    db.update(transcriptions)
      .set({ status: "reading", errorMessage: null, updatedAt: Date.now() })
      .where(eq(transcriptions.id, row.id))
      .run();
    startDocumentSummary(db, row.id);
    return NextResponse.json({ id: row.id });
  }

  if (!row.sourceUploadPath) {
    return NextResponse.json({ error: "no upload to retry" }, { status: 400 });
  }
  db.update(transcriptions)
    .set({ status: "transcribing", errorMessage: null, updatedAt: Date.now() })
    .where(eq(transcriptions.id, row.id))
    .run();
  startTranscription(db, row.id);
  return NextResponse.json({ id: row.id });
}
