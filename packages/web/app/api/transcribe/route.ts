import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createTranscription } from "@event-editor/core/transcription";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startTranscription } from "@/lib/transcriber";

export const runtime = "nodejs";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "audio";
}

export async function POST(request: Request) {
  const raw = request.headers.get("x-filename") ?? new URL(request.url).searchParams.get("filename");
  if (!raw) return NextResponse.json({ error: "x-filename header required" }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const filename = safeName(raw);
  const db = getDb();
  const id = createTranscription(db, { originalFilename: filename });

  const dir = resolve("data/uploads", String(id));
  const path = resolve(dir, filename);

  try {
    await mkdir(dir, { recursive: true });
    await pipeline(Readable.fromWeb(request.body as any), createWriteStream(path));

    db.update(transcriptions)
      .set({ sourceUploadPath: `data/uploads/${id}/${filename}`, updatedAt: Date.now() })
      .where(eq(transcriptions.id, id))
      .run();

    startTranscription(db, id);
    return NextResponse.json({ id });
  } catch (err) {
    db.update(transcriptions)
      .set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
      })
      .where(eq(transcriptions.id, id))
      .run();
    return NextResponse.json({ id, error: "upload failed" }, { status: 500 });
  }
}
