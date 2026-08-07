import { eq } from "drizzle-orm";
import { buildDocSections, buildDocHtml, type MergedSegment } from "@event-editor/core/transcribe";
import type { openDb } from "@event-editor/core/db";
import { transcriptions } from "@event-editor/core/schema";
import { authedDriveClient, authedDocsClient } from "./google/oauth";
import { updateGoogleDoc, writeDocTab, deleteDocTab } from "./google/docs";

type Db = ReturnType<typeof openDb>;

export type DocSyncRow = {
  id: number;
  docId: string | null;
  summaryText: string | null;
  transcriptText: string | null;
  transcriptSegments: string | null;
  summaryLinkedin: string | null;
  summaryArticle: string | null;
  sourceKind: string | null;
  sourceDocId: string | null;
  docTabId: string | null;
};

function segmentsOf(row: DocSyncRow): MergedSegment[] {
  if (row.transcriptSegments) {
    try {
      const parsed = JSON.parse(row.transcriptSegments);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }
  // Rows from before segments were stored: one untimed block keeps the
  // transcript in the doc rather than dropping it.
  return row.transcriptText ? [{ startSec: 0, text: row.transcriptText }] : [];
}

/** Rewrite the transcription's Google Doc so the LinkedIn/article drafts sit
 *  between the summary and the transcript. Best-effort: returns false (never
 *  throws) when there is no doc, no summary, or no Google connection, so draft
 *  saves keep working offline.
 *
 *  A gdoc row's doc has tabs, and updateGoogleDoc is a whole-file HTML
 *  re-import: pointed at a multi-tab doc it would replace the user's original
 *  content. So that path is unreachable here by construction; gdoc rows only
 *  ever go through writeDocTab/deleteDocTab. */
export async function syncTranscriptionDoc(db: Db, row: DocSyncRow): Promise<boolean> {
  if (!row.summaryText) return false;
  try {
    const kind = row.sourceKind ?? "audio";
    const sections = buildDocSections({
      sourceKind: kind as any,
      summary: row.summaryText,
      linkedin: row.summaryLinkedin,
      article: row.summaryArticle,
      segments: segmentsOf(row),
      sourceText: row.transcriptText,
    });

    if (kind === "gdoc") {
      if (!row.sourceDocId) return false;
      const docs = await authedDocsClient(db);
      if (!docs) return false;
      if (row.docTabId) await deleteDocTab(docs, row.sourceDocId, row.docTabId);
      const { tabId } = await writeDocTab(docs, row.sourceDocId, "Summary", sections);
      // Best-effort write-back: writeDocTab mints a fresh tabId every call, so
      // if this doesn't stick the next sync will try to delete a tab that no
      // longer exists. Still, a metadata-write failure shouldn't undo a doc
      // write that already succeeded.
      try {
        db.update(transcriptions)
          .set({ docTabId: tabId, updatedAt: Date.now() })
          .where(eq(transcriptions.id, row.id))
          .run();
      } catch {}
      return true;
    }

    if (!row.docId) return false;
    const drive = await authedDriveClient(db);
    if (!drive) return false;
    await updateGoogleDoc(drive, row.docId, buildDocHtml(sections));
    return true;
  } catch {
    return false;
  }
}
