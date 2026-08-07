import { runDocumentSummary } from "@event-editor/core/transcription";
import { buildDocHtml } from "@event-editor/core/transcribe";
import type { openDb } from "@event-editor/core/db";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import { visionClient, summarizeDocument, extractEventDetails } from "./anthropic";
import { authedDriveClient, authedDocsClient } from "./google/oauth";
import { createGoogleDoc, writeDocTab, deleteDocTab, docTabUrl, friendlyDocsError } from "./google/docs";
import { withBackoff } from "./backoff";

type Db = ReturnType<typeof openDb>;

function fail(db: Db, id: number, message: string) {
  db.update(transcriptions)
    .set({ status: "error", errorMessage: message, updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();
}

export function startDocumentSummary(db: Db, id: number): void {
  // Preflight synchronously, same reason as startTranscription: a missing-key
  // throw would land outside the try/catch and strand the row.
  if (!process.env.ANTHROPIC_API_KEY) return fail(db, id, "ANTHROPIC_API_KEY is not set");
  const client = visionClient();

  void (async () => {
    const drive = await authedDriveClient(db);
    if (!drive) { fail(db, id, "Google is not connected. Re-auth on /settings."); return; }

    await runDocumentSummary(db, id, {
      summarize: (text) => withBackoff(() => summarizeDocument(client, text)),
      extractDetails: (contextText, text) => withBackoff(() => extractEventDetails(client, contextText, text)),
      writeDoc: async (sections, name, row) => {
        // A gdoc source writes a tab inside the original. Anything else gets
        // its own new doc through the existing Drive HTML import.
        if (row.sourceKind === "gdoc" && row.sourceDocId) {
          const docs = await authedDocsClient(db);
          if (!docs) throw new Error("Google is not connected. Re-auth on /settings.");
          try {
            const { tabId } = await writeDocTab(docs, row.sourceDocId, "Summary", sections);
            return { id: row.sourceDocId, url: docTabUrl(row.sourceDocId, tabId), tabId };
          } catch (err) {
            throw new Error(friendlyDocsError(err));
          }
        }
        const doc = await createGoogleDoc(drive, buildDocHtml(sections), name);
        return { id: doc.id, url: doc.url };
      },
    });
  })();
}
