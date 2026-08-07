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

    // Route on more than `sourceKind` alone: a gdoc row's docId always equals
    // its sourceDocId (the summary tab lives inside the user's own document),
    // so that equality is itself evidence of a tab-backed doc even if
    // `sourceKind` were ever wrong (bad migration, backfill, manual edit).
    // Treating either signal as authoritative is what makes updateGoogleDoc
    // provably unreachable for a tab-backed row, not just unreachable by
    // convention.
    const tabBacked = kind === "gdoc" || (!!row.sourceDocId && row.docId === row.sourceDocId);

    if (tabBacked) {
      if (!row.sourceDocId) return false;
      const docs = await authedDocsClient(db);
      if (!docs) return false;
      // Order matters: write the new tab and persist its id BEFORE deleting the
      // old one. If the persist step fails partway, the row still points at the
      // OLD tab, which still exists — so the next sync's delete is still valid
      // and self-heals. Deleting first (and persisting after) would instead
      // leave a permanently wedged row whenever the persist is lost: the next
      // sync would try to delete an id that's already gone.
      const { tabId } = await writeDocTab(docs, row.sourceDocId, "Summary", sections);
      db.update(transcriptions)
        .set({ docTabId: tabId, updatedAt: Date.now() })
        .where(eq(transcriptions.id, row.id))
        .run();
      if (row.docTabId) await deleteDocTab(docs, row.sourceDocId, row.docTabId);
      return true;
    }

    if (!row.docId) return false;
    // Defense in depth: even if the tabBacked check above is ever bypassed by
    // a future refactor, never let updateGoogleDoc run against a doc that
    // also serves as a source doc for tabs.
    if (row.sourceDocId && row.docId === row.sourceDocId) return false;
    const drive = await authedDriveClient(db);
    if (!drive) return false;
    await updateGoogleDoc(drive, row.docId, buildDocHtml(sections));
    return true;
  } catch {
    return false;
  }
}
