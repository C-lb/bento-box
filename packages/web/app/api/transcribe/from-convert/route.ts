import { NextResponse } from "next/server";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createTranscription } from "@event-editor/core/transcription";
import { swapExt } from "@event-editor/core/names";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startTranscription } from "@/lib/transcriber";
import { convertDir, sanitizeConvertId } from "@/lib/convert";
import { dataRoot } from "@/lib/jobs";
import { guardUpload } from "@/lib/upload-guard";

export const runtime = "nodejs";

const AUDIO_EXTS = new Set(["mp3", "wav", "m4a"]);

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "audio";
}

// Hands a finished /api/convert/url result straight to the transcription
// pipeline: copy (not move, so Download/Drive still work) into the uploads
// layout the transcriber expects, then start the normal job.
export async function POST(request: Request) {
  // Lives under the middleware-exempt /api/transcribe prefix, so auth must run
  // here (see lib/upload-guard.ts) even though this route takes no file body.
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const { convertId, filename, ext: rawExt } = (await request.json().catch(() => ({}))) as {
    convertId?: string; filename?: string; ext?: string;
  };
  if (!convertId) return NextResponse.json({ error: "convertId required" }, { status: 400 });
  const ext = rawExt && AUDIO_EXTS.has(rawExt) ? rawExt : "mp3";

  const sourcePath = resolve(convertDir(sanitizeConvertId(convertId)), `out.${ext}`);
  if (!existsSync(sourcePath)) {
    return NextResponse.json({ error: "The converted audio was not found. Convert again first." }, { status: 404 });
  }

  const name = safeName(swapExt(filename || "audio", ext));
  let db: ReturnType<typeof getDb>;
  let id: number;
  try {
    db = getDb();
    id = createTranscription(db, { originalFilename: name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not start the transcription: ${message}` }, { status: 500 });
  }

  try {
    const dir = resolve(dataRoot(), "uploads", String(id));
    const path = resolve(dir, name);
    await mkdir(dir, { recursive: true });
    await copyFile(sourcePath, path);

    db.update(transcriptions)
      .set({ sourceUploadPath: path, updatedAt: Date.now() })
      .where(eq(transcriptions.id, id))
      .run();

    startTranscription(db, id);
    return NextResponse.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(transcriptions)
      .set({ status: "error", errorMessage: message, updatedAt: Date.now() })
      .where(eq(transcriptions.id, id))
      .run();
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
