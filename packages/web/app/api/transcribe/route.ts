import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { eq, desc } from "drizzle-orm";
import { createTranscription } from "@event-editor/core/transcription";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startTranscription } from "@/lib/transcriber";
import { linkStash } from "@/lib/context";
import { guardUpload } from "@/lib/upload-guard";
import { dataRoot } from "@/lib/jobs";

export const runtime = "nodejs";

// All transcriptions, newest first, for the history panel.
export async function GET() {
  const rows = getDb()
    .select()
    .from(transcriptions)
    .orderBy(desc(transcriptions.createdAt))
    .all();
  return NextResponse.json({
    transcriptions: rows.map((r) => ({
      id: r.id,
      originalFilename: r.originalFilename,
      status: r.status,
      docUrl: r.docUrl,
      createdAt: r.createdAt,
      hasLinkedin: !!r.summaryLinkedin,
      hasArticle: !!r.summaryArticle,
    })),
  });
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "audio";
}

export async function POST(request: Request) {
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const raw = request.headers.get("x-filename") ?? new URL(request.url).searchParams.get("filename");
  if (!raw) return NextResponse.json({ error: "x-filename header required" }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const filename = safeName(raw);
  let db: ReturnType<typeof getDb>;
  let id: number;
  try {
    db = getDb();
    id = createTranscription(db, { originalFilename: filename });
  } catch (err) {
    // Before this catch, a throw here (db open, insert) surfaced as a bare
    // "Internal Server Error" page with no hint of the cause.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not start the upload: ${message}` }, { status: 500 });
  }

  // Absolute, EE_DATA_DIR-aware: cwd-relative "data/uploads" wrote inside the
  // packaged app bundle, where a shipped stale dir 7 contaminated a transcript.
  const dir = resolve(dataRoot(), "uploads", String(id));
  const path = resolve(dir, filename);

  try {
    await mkdir(dir, { recursive: true });
    await pipeline(Readable.fromWeb(request.body as any), createWriteStream(path));

    db.update(transcriptions)
      .set({ sourceUploadPath: path, updatedAt: Date.now() })
      .where(eq(transcriptions.id, id))
      .run();

    const contextId = request.headers.get("x-context-id");
    if (contextId) await linkStash(db, id, contextId);

    startTranscription(db, id);
    return NextResponse.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(transcriptions)
      .set({
        status: "error",
        errorMessage: message,
        updatedAt: Date.now(),
      })
      .where(eq(transcriptions.id, id))
      .run();
    return NextResponse.json({ id, error: `Upload failed: ${message}` }, { status: 500 });
  }
}
