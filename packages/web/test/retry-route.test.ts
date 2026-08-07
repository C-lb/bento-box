import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";

const tmp = mkdtempSync(resolve(tmpdir(), "retryroute-"));
process.env.EE_DB_PATH = resolve(tmp, "app.db");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const { openDb } = await import("@event-editor/core/db");
const { runMigrations } = await import("@event-editor/core/migrate");
const { transcriptions } = await import("@event-editor/core/schema");
const { createTranscription } = await import("@event-editor/core/transcription");
const db = openDb(process.env.EE_DB_PATH);
runMigrations(db);

const startTranscription = vi.fn();
const startDocumentSummary = vi.fn();
vi.mock("@/lib/transcriber", () => ({ startTranscription }));
vi.mock("@/lib/document-runner", () => ({ startDocumentSummary }));

const { POST } = await import("@/app/api/transcribe/[id]/retry/route");

beforeEach(() => { startTranscription.mockClear(); startDocumentSummary.mockClear(); });

function seed(over: Record<string, unknown>): number {
  const id = createTranscription(db, { originalFilename: "report.docx" });
  db.update(transcriptions).set(over).where(eq(transcriptions.id, id)).run();
  return id;
}

function retry(id: number) {
  return POST(new Request("http://localhost/retry", { method: "POST" }), {
    params: Promise.resolve({ id: String(id) }),
  });
}

describe("POST /api/transcribe/[id]/retry", () => {
  it("re-runs the audio pipeline from the stored upload, as before", async () => {
    const id = seed({ sourceUploadPath: "/tmp/a.mp3", status: "error", errorMessage: "boom" });
    const res = await retry(id);
    expect(res.status).toBe(200);
    expect(startTranscription).toHaveBeenCalledOnce();
    expect(startDocumentSummary).not.toHaveBeenCalled();
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("transcribing");
    expect(row.errorMessage).toBeNull();
  });

  // A gdoc row has no upload: its extracted text is already in transcriptText.
  // Rejecting it on sourceUploadPath dead-ends the branch's own recovery path,
  // where a user hits the missing-documents-scope error, reconnects Google, and
  // presses the "Try again" button the UI offers them.
  it("re-runs the document pipeline for a gdoc row that has no upload", async () => {
    const id = seed({
      sourceKind: "gdoc", sourceDocId: "srcdoc", transcriptText: "the doc body",
      status: "error", errorMessage: "Reconnect Google in Settings to allow writing into documents.",
    });
    const res = await retry(id);
    expect(res.status).toBe(200);
    expect(startDocumentSummary).toHaveBeenCalledOnce();
    expect(startTranscription).not.toHaveBeenCalled();
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("reading");
    expect(row.errorMessage).toBeNull();
  });

  it("re-runs the document pipeline for a dragged document row", async () => {
    const id = seed({ sourceKind: "document", transcriptText: "the doc body", status: "error" });
    const res = await retry(id);
    expect(res.status).toBe(200);
    expect(startDocumentSummary).toHaveBeenCalledOnce();
    expect(startTranscription).not.toHaveBeenCalled();
  });

  it("still 400s a document row with nothing to re-summarise", async () => {
    const id = seed({ sourceKind: "document", transcriptText: null, status: "error" });
    const res = await retry(id);
    expect(res.status).toBe(400);
    expect(startDocumentSummary).not.toHaveBeenCalled();
  });

  it("still 400s an audio row with no upload", async () => {
    const id = seed({ status: "error" });
    const res = await retry(id);
    expect(res.status).toBe(400);
    expect(startTranscription).not.toHaveBeenCalled();
  });

  it("404s an unknown id", async () => {
    expect((await retry(99999)).status).toBe(404);
  });
});
