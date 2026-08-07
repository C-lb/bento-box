import { eq } from "drizzle-orm";
import { buildDocSections, buildDocHtml, type MergedSegment } from "@event-editor/core/transcribe";
import type { openDb } from "@event-editor/core/db";
import { transcriptions } from "@event-editor/core/schema";
import { authedDriveClient, authedDocsClient } from "./google/oauth";
import { updateGoogleDoc, writeDocTab, deleteDocTab, docTabUrl } from "./google/docs";

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
/** One in-flight sync per row id, chained.
 *
 *  Blurring one draft field straight into another fires two /summary saves
 *  back to back. Both read the row before either has run, so both carry the
 *  same stale `docTabId`: each writes a new tab and each deletes the same old
 *  one, and the loser's tab is orphaned in the user's own document forever
 *  (the second delete 400s and is swallowed, so nothing surfaces).
 *
 *  A promise chain keyed on row id is enough here because the app is a single
 *  Node process (packaged Electron / one Next server) with one sqlite file: a
 *  Map lookup plus reassignment is atomic under the event loop, so the second
 *  caller always observes the first's promise and cannot interleave. Chaining
 *  alone would not fix it, though, so the critical section also re-reads
 *  `doc_tab_id` from the db instead of trusting the caller's snapshot: by the
 *  time the second sync runs, the first has persisted the id of the tab that
 *  actually exists, and that is the one to delete. */
const syncChains = new Map<number, Promise<boolean>>();

export function syncTranscriptionDoc(db: Db, row: DocSyncRow): Promise<boolean> {
  const prev = syncChains.get(row.id) ?? Promise.resolve(false);
  const next = prev.then(() => syncOnce(db, row), () => syncOnce(db, row));
  syncChains.set(row.id, next);
  void next.finally(() => {
    if (syncChains.get(row.id) === next) syncChains.delete(row.id);
  });
  return next;
}

async function syncOnce(db: Db, row: DocSyncRow): Promise<boolean> {
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
      // Read the tab we own from the db, not from the caller's snapshot: an
      // earlier sync in this chain may have replaced it since the row was read.
      const persisted = db
        .select({ docTabId: transcriptions.docTabId })
        .from(transcriptions)
        .where(eq(transcriptions.id, row.id))
        .all()[0];
      const oldTabId = persisted ? persisted.docTabId : row.docTabId;

      const { tabId } = await writeDocTab(docs, row.sourceDocId, "Summary", sections);
      // Backfill docId/docUrl too: a gdoc row that errored during the initial
      // write has neither, so without this the user ends up with a real tab
      // and no link to it.
      db.update(transcriptions)
        .set({
          docTabId: tabId,
          docId: row.sourceDocId,
          docUrl: docTabUrl(row.sourceDocId, tabId),
          updatedAt: Date.now(),
        })
        .where(eq(transcriptions.id, row.id))
        .run();
      if (oldTabId) await deleteDocTab(docs, row.sourceDocId, oldTabId);
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
