import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { transcriptions } from "./schema/index.js";
import { mergeSegments, buildTranscriptHtml, docBaseName, type ChunkResult, type MergedSegment } from "./transcribe.js";

export interface PreparedChunks {
  paths: string[];
  offsets: number[];
  durationSec: number;
}

export interface TranscriptionDeps {
  prepareChunks(sourcePath: string, chunkSec: number): Promise<PreparedChunks>;
  transcribeChunk(path: string): Promise<ChunkResult>;
  summarize(transcript: string): Promise<string>;
  createDoc(html: string, name: string): Promise<{ id: string; url: string }>;
}

const DEFAULT_CHUNK_SEC = Number(process.env.EE_TRANSCRIBE_CHUNK_SEC ?? 600);

function touch(db: BetterSQLite3Database<any>, id: number, set: Record<string, unknown>) {
  db.update(transcriptions).set({ ...set, updatedAt: Date.now() }).where(eq(transcriptions.id, id)).run();
}

export function createTranscription(
  db: BetterSQLite3Database<any>,
  args: { originalFilename: string },
): number {
  const now = Date.now();
  const res = db
    .insert(transcriptions)
    .values({
      originalFilename: args.originalFilename,
      sourceUploadPath: "",
      status: "uploading",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

function plainText(segments: MergedSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}

export async function runTranscription(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: TranscriptionDeps,
  opts?: { chunkSec?: number },
): Promise<void> {
  const chunkSec = opts?.chunkSec ?? DEFAULT_CHUNK_SEC;
  try {
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    if (!row) throw new Error(`transcription ${id} not found`);

    touch(db, id, { status: "transcribing" });
    const prepared = await deps.prepareChunks(row.sourceUploadPath, chunkSec);
    touch(db, id, { durationSec: prepared.durationSec });

    const results: ChunkResult[] = [];
    for (const path of prepared.paths) {
      results.push(await deps.transcribeChunk(path));
    }
    const segments = mergeSegments(results, prepared.offsets);
    const transcript = plainText(segments);
    touch(db, id, { transcriptText: transcript, status: "summarizing" });

    const summary = await deps.summarize(transcript);
    touch(db, id, { summaryText: summary, status: "creating_doc" });

    const html = buildTranscriptHtml(summary, segments);
    const docName = docBaseName(row.originalFilename) + " transcript";
    const doc = await deps.createDoc(html, docName);
    touch(db, id, { docId: doc.id, docUrl: doc.url, status: "done" });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
