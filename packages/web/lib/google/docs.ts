import { Readable } from "node:stream";
import type { drive_v3, docs_v1 } from "googleapis";
import { buildTabRequests, type DocSection } from "@event-editor/core/transcribe";

// Replace the whole body of an existing Doc (same id and URL). Drive re-imports
// the HTML the same way create does, so any manual edits in the Doc are lost.
export async function updateGoogleDoc(
  drive: drive_v3.Drive,
  fileId: string,
  html: string,
): Promise<void> {
  await drive.files.update({
    fileId,
    media: { mimeType: "text/html", body: Readable.from(html) },
  });
}

export async function createGoogleDoc(
  drive: drive_v3.Drive,
  html: string,
  name: string,
): Promise<{ id: string; url: string }> {
  const res = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.document" },
    media: { mimeType: "text/html", body: Readable.from(html) },
    fields: "id, webViewLink",
  });
  const id = res.data.id;
  if (!id) throw new Error("Drive did not return a document id");
  return { id, url: res.data.webViewLink ?? `https://docs.google.com/document/d/${id}/edit` };
}

/** Write the sections into a brand new tab of an existing Doc. Two calls: the
 *  first adds the tab and returns its id in the reply, the second fills it. */
export async function writeDocTab(
  docs: docs_v1.Docs,
  docId: string,
  title: string,
  sections: DocSection[],
): Promise<{ tabId: string }> {
  // The installed googleapis type defs don't yet model the tabs API
  // (addDocumentTab/deleteTab, or the tab id on the reply), even though the
  // live API supports it. Cast at the edges; runtime shape is per Google's docs.
  const added: any = await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ addDocumentTab: { tabProperties: { title } } }] as any },
  });
  const tabId = added.data.replies?.[0]?.addDocumentTab?.tabProperties?.tabId;
  if (!tabId) throw new Error("Docs did not return a tab id");

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: buildTabRequests(sections, tabId) as any },
  });
  return { tabId };
}

/** Best-effort delete. A 404 means the user deleted our tab by hand; a 400
 *  INVALID_ARGUMENT means the id we were given is stale (e.g. a lost
 *  write-back pointed us at a tab that's already gone). Either way the tab is
 *  already absent, which is the state this call is trying to reach, so a
 *  stale id must never block a subsequent write. */
export async function deleteDocTab(
  docs: docs_v1.Docs,
  docId: string,
  tabId: string,
): Promise<void> {
  try {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ deleteTab: { tabId } }] as any },
    });
  } catch (err: any) {
    if (err?.code === 404 || err?.code === 400) return;
    throw err;
  }
}

export function docTabUrl(docId: string, tabId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit?tab=${tabId}`;
}

/** Tokens minted before the documents scope existed 403 on the first tab
 *  write. That is a different fix from a view-only document, so say which. */
export function friendlyDocsError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code;
  if (code === 403 && /insufficient.*scope/i.test(message)) {
    return "Reconnect Google in Settings to allow writing into documents.";
  }
  if (code === 403) {
    return "You don't have edit access to that document.";
  }
  return message;
}
