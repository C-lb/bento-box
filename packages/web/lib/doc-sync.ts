import { buildDocHtml, type MergedSegment } from "@event-editor/core/transcribe";
import type { openDb } from "@event-editor/core/db";
import { authedDriveClient } from "./google/oauth";
import { updateGoogleDoc } from "./google/docs";

type Db = ReturnType<typeof openDb>;

export type DocSyncRow = {
  docId: string | null;
  summaryText: string | null;
  transcriptText: string | null;
  transcriptSegments: string | null;
  summaryLinkedin: string | null;
  summaryArticle: string | null;
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
 *  saves keep working offline. */
export async function syncTranscriptionDoc(db: Db, row: DocSyncRow): Promise<boolean> {
  if (!row.docId || !row.summaryText) return false;
  try {
    const drive = await authedDriveClient(db);
    if (!drive) return false;
    const html = buildDocHtml(row.summaryText, segmentsOf(row), {
      linkedin: row.summaryLinkedin,
      article: row.summaryArticle,
    });
    await updateGoogleDoc(drive, row.docId, html);
    return true;
  } catch {
    return false;
  }
}
