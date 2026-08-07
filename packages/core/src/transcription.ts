import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { transcriptions } from "./schema/index.js";
import { mergeSegments, buildDocSections, buildDocHtml, docBaseName, type ChunkResult, type MergedSegment, type EventDetails, type DocSection } from "./transcribe.js";

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
  extractDetails(contextText: string, transcript: string): Promise<EventDetails>;
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
    touch(db, id, { transcriptText: transcript, transcriptSegments: JSON.stringify(segments), status: "summarizing" });

    const summary = await deps.summarize(transcript);
    touch(db, id, { summaryText: summary, status: "creating_doc" });

    let details: EventDetails;
    try {
      details = await deps.extractDetails(row.contextText ?? "", transcript);
    } catch {
      details = { eventName: "", eventDescription: "", speakers: [], sponsors: [] };
    }
    touch(db, id, { eventDetails: JSON.stringify(details) });

    const html = buildDocHtml(
      buildDocSections({ sourceKind: "audio", summary, segments, linkedin: null, article: null }),
    );
    const docName = docBaseName(row.originalFilename) + " transcript";
    const doc = await deps.createDoc(html, docName);
    touch(db, id, { docId: doc.id, docUrl: doc.url, status: "done" });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}

export interface DocumentSummaryDeps {
  summarize(text: string): Promise<string>;
  extractDetails(contextText: string, text: string): Promise<EventDetails>;
  writeDoc(
    sections: DocSection[],
    name: string,
    row: { sourceKind: string | null; sourceDocId: string | null },
  ): Promise<{ id: string; url: string; tabId?: string }>;
}

// The document path joins runTranscription's pipeline at the summarize stage:
// the text is already extracted at ingest, so there is nothing to chunk.
export async function runDocumentSummary(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: DocumentSummaryDeps,
): Promise<void> {
  try {
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    if (!row) throw new Error(`transcription ${id} not found`);
    const text = row.transcriptText ?? "";
    if (!text.trim()) throw new Error("no document text to summarize");

    touch(db, id, { status: "summarizing" });
    const summary = await deps.summarize(text);
    touch(db, id, { summaryText: summary, status: "creating_doc" });

    let details: EventDetails;
    try {
      details = await deps.extractDetails(row.contextText ?? "", text);
    } catch {
      details = { eventName: "", eventDescription: "", speakers: [], sponsors: [] };
    }
    touch(db, id, { eventDetails: JSON.stringify(details) });

    const sections = buildDocSections({
      sourceKind: (row.sourceKind as any) ?? "document",
      summary,
      linkedin: null,
      article: null,
      sourceText: text,
    });
    const doc = await deps.writeDoc(sections, docBaseName(row.originalFilename) + " summary", {
      sourceKind: row.sourceKind,
      sourceDocId: row.sourceDocId,
    });
    touch(db, id, {
      docId: doc.id,
      docUrl: doc.url,
      docTabId: doc.tabId ?? null,
      status: "done",
    });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
