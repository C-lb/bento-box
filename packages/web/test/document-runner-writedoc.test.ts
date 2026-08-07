import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";

// This file exists because runDocumentSummary's own tests inject `writeDoc`,
// which means the real closure in lib/document-runner.ts — the branch deciding
// whether we write a tab into the user's own document or create a brand new
// one — was never executed by anything. Deleting `&& row.sourceDocId` from it,
// or swapping the two branches outright, left the whole suite green. So these
// tests drive the real closure with mocked Google clients and assert on which
// Google call was made.

const tmp = mkdtempSync(resolve(tmpdir(), "docrunner-"));
process.env.EE_DB_PATH = resolve(tmp, "app.db");
process.env.ANTHROPIC_API_KEY = "test-key";
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const { openDb } = await import("@event-editor/core/db");
const { runMigrations } = await import("@event-editor/core/migrate");
const { transcriptions } = await import("@event-editor/core/schema");
const db = openDb(process.env.EE_DB_PATH);
runMigrations(db);

vi.mock("@/lib/anthropic", () => ({
  visionClient: () => ({}),
  summarizeDocument: async () => "the summary",
  extractEventDetails: async () => ({
    eventName: "", eventDescription: "", speakers: [], sponsors: [],
  }),
}));

// Google clients are stubbed, but lib/google/docs.ts itself is NOT: writeDocTab
// really runs, so the tab requests really reach batchUpdate.
const filesCreate = vi.fn();
const batchUpdate = vi.fn();
vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: async () => ({ files: { create: filesCreate } }),
  authedDocsClient: async () => ({ documents: { batchUpdate } }),
}));

const { startDocumentSummary } = await import("@/lib/document-runner");
const { createTranscription } = await import("@event-editor/core/transcription");

beforeEach(() => {
  filesCreate.mockReset().mockResolvedValue({
    data: { id: "newdoc", webViewLink: "https://docs.google.com/document/d/newdoc/edit" },
  });
  batchUpdate.mockReset().mockResolvedValue({
    data: { replies: [{ addDocumentTab: { tabProperties: { tabId: "t.new" } } }] },
  });
});

function seed(over: Record<string, unknown>): number {
  const id = createTranscription(db, { originalFilename: "report.docx" });
  db.update(transcriptions)
    .set({ transcriptText: "the document body", status: "reading", ...over })
    .where(eq(transcriptions.id, id))
    .run();
  return id;
}

/** startDocumentSummary is fire-and-forget, so poll the row it owns. */
async function settle(id: number) {
  for (let i = 0; i < 200; i++) {
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    if (row.status === "done" || row.status === "error") return row;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("transcription never settled");
}

describe("startDocumentSummary's writeDoc closure", () => {
  it("writes a tab into the user's own document for a gdoc with a source doc id", async () => {
    const id = seed({ sourceKind: "gdoc", sourceDocId: "srcdoc" });
    startDocumentSummary(db, id);
    const row = await settle(id);

    expect(row.status).toBe("done");
    expect(filesCreate).not.toHaveBeenCalled();
    expect(batchUpdate).toHaveBeenCalledTimes(2);
    expect(batchUpdate.mock.calls[0][0]).toMatchObject({
      documentId: "srcdoc",
      requestBody: { requests: [{ addDocumentTab: { tabProperties: { title: "Summary" } } }] },
    });
    // The output must land in the user's document, not a new one.
    expect(row.docId).toBe("srcdoc");
    expect(row.docTabId).toBe("t.new");
    expect(row.docUrl).toBe("https://docs.google.com/document/d/srcdoc/edit?tab=t.new");
  });

  it("does NOT write a tab for a gdoc with no source doc id, it creates a new doc", async () => {
    // Without the `&& row.sourceDocId` guard this would call writeDocTab with
    // an undefined document id and blow up on a doc the user never picked.
    const id = seed({ sourceKind: "gdoc", sourceDocId: null });
    startDocumentSummary(db, id);
    const row = await settle(id);

    expect(row.status).toBe("done");
    expect(batchUpdate).not.toHaveBeenCalled();
    expect(filesCreate).toHaveBeenCalledOnce();
    expect(row.docId).toBe("newdoc");
    expect(row.docTabId).toBeNull();
  });

  it("creates a new Google Doc for a dragged document", async () => {
    const id = seed({ sourceKind: "document", sourceDocId: null });
    startDocumentSummary(db, id);
    const row = await settle(id);

    expect(row.status).toBe("done");
    expect(batchUpdate).not.toHaveBeenCalled();
    expect(filesCreate).toHaveBeenCalledOnce();
    // Named from the source file, and the body really is the rendered HTML.
    expect(filesCreate.mock.calls[0][0].requestBody.name).toBe("report summary");
    expect(row.docId).toBe("newdoc");
    expect(row.docUrl).toBe("https://docs.google.com/document/d/newdoc/edit");
  });

  it("surfaces a missing documents scope as the reconnect message", async () => {
    batchUpdate.mockRejectedValue(
      Object.assign(new Error("Request had insufficient authentication scopes."), { code: 403 }),
    );
    const id = seed({ sourceKind: "gdoc", sourceDocId: "srcdoc" });
    startDocumentSummary(db, id);
    const row = await settle(id);

    expect(row.status).toBe("error");
    expect(row.errorMessage).toMatch(/Reconnect Google in Settings/i);
  });
});
