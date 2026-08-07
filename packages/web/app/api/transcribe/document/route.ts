import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createTranscription } from "@event-editor/core/transcription";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import {
  documentExtFromName, extractDocumentText, assertDocumentLength, DOCUMENT_EXTS,
} from "@/lib/context";
import { startDocumentSummary } from "@/lib/document-runner";
import { guardUpload } from "@/lib/upload-guard";

export const runtime = "nodejs";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "document";
}

export async function POST(request: Request) {
  // Lives under the middleware-exempt /api/transcribe prefix, so auth runs
  // here (see lib/upload-guard.ts).
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const contentType = request.headers.get("content-type") ?? "";
  let name: string;
  let text: string;
  let sourceKind: "document" | "gdoc";
  let sourceDocId: string | null = null;

  try {
    if (contentType.includes("application/json")) {
      const { fileId, name: given } = (await request.json().catch(() => ({}))) as {
        fileId?: string; name?: string;
      };
      if (!fileId) {
        return NextResponse.json({ error: "Pick a Google Doc, or drop a file." }, { status: 400 });
      }
      const drive = await authedDriveClient(getDb());
      if (!drive) {
        return NextResponse.json({ error: "Google is not connected. Re-auth on /settings." }, { status: 400 });
      }
      const res = await drive.files.export({ fileId, mimeType: "text/plain" });
      text = String(res.data ?? "").trim();
      if (!text) return NextResponse.json({ error: "That document is empty." }, { status: 400 });
      // Same cap as the dragged-file path: without it a huge picked Doc goes
      // straight to the model and comes back as a raw context-length error,
      // after the token spend.
      assertDocumentLength(text);
      name = safeName(given || "document");
      sourceKind = "gdoc";
      sourceDocId = fileId;
    } else {
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Pick a Google Doc, or drop a file." }, { status: 400 });
      }
      const ext = documentExtFromName(file.name);
      if (!ext) {
        return NextResponse.json(
          { error: `That file type isn't supported. Try one of: ${DOCUMENT_EXTS.join(", ")}.` },
          { status: 400 },
        );
      }
      text = await extractDocumentText(Buffer.from(await file.arrayBuffer()), ext);
      name = safeName(file.name);
      sourceKind = "document";
    }
  } catch (err) {
    // Extraction errors (empty, scanned, over the cap) are user-facing.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const db = getDb();
  const id = createTranscription(db, { originalFilename: name });
  db.update(transcriptions)
    .set({ sourceKind, sourceDocId, transcriptText: text, status: "reading", updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();

  startDocumentSummary(db, id);
  return NextResponse.json({ id });
}
