import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Real sqlite db in a temp dir; @/lib/db opens EE_DB_PATH lazily so setting it
// before the first request is enough (same pattern as runs-route.test.ts).
// This route really inserts a row via createTranscription and then updates
// it, so a `{}` db stub would not exercise that path.
const tmp = mkdtempSync(resolve(tmpdir(), "documentroute-"));
process.env.EE_DB_PATH = resolve(tmp, "app.db");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const { openDb } = await import("@event-editor/core/db");
const { runMigrations } = await import("@event-editor/core/migrate");
runMigrations(openDb(process.env.EE_DB_PATH));

const startDocumentSummary = vi.fn();
vi.mock("@/lib/document-runner", () => ({ startDocumentSummary }));

const exportFn = vi.fn();
vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: async () => ({ files: { export: exportFn } }),
}));

vi.mock("@/lib/upload-guard", () => ({ guardUpload: async () => null }));

const { POST } = await import("@/app/api/transcribe/document/route");

beforeEach(() => { startDocumentSummary.mockClear(); exportFn.mockClear(); });

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/transcribe/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/transcribe/document", () => {
  it("rejects an unsupported file extension and names what it accepts", async () => {
    const form = new FormData();
    form.set("file", new File(["x"], "talk.mp3"));
    const res = await POST(new Request("http://localhost/api/transcribe/document", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/docx/);
  });

  it("accepts a txt upload and starts the job", async () => {
    const form = new FormData();
    form.set("file", new File(["some body text"], "notes.txt"));
    const res = await POST(new Request("http://localhost/api/transcribe/document", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("id");
    expect(startDocumentSummary).toHaveBeenCalledOnce();
  });

  it("surfaces an empty document as a 400, not a started job", async () => {
    const form = new FormData();
    form.set("file", new File(["   "], "notes.txt"));
    const res = await POST(new Request("http://localhost/api/transcribe/document", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    expect(startDocumentSummary).not.toHaveBeenCalled();
  });

  it("exports a picked Google Doc as plain text and starts the job", async () => {
    exportFn.mockResolvedValue({ data: "the doc body" });
    const res = await POST(jsonRequest({ fileId: "doc1", name: "Board Pack" }));
    expect(res.status).toBe(200);
    expect(exportFn).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "doc1", mimeType: "text/plain" }),
    );
    expect(startDocumentSummary).toHaveBeenCalledOnce();
  });

  // The dragged-file path caps inside extractDocumentText; the Picker path
  // never calls it, so without an explicit cap a 600k-character Doc goes
  // straight to the model and comes back as a raw context-length error, after
  // the token spend.
  it("caps a picked Google Doc at the same length as a dragged file", async () => {
    const { MAX_DOC_CHARS } = await import("@/lib/context");
    exportFn.mockResolvedValue({ data: "a".repeat(MAX_DOC_CHARS + 1) });
    const res = await POST(jsonRequest({ fileId: "huge", name: "Huge" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long to summarise/i);
    expect(startDocumentSummary).not.toHaveBeenCalled();
  });

  it("accepts a picked Google Doc exactly at the cap", async () => {
    const { MAX_DOC_CHARS } = await import("@/lib/context");
    exportFn.mockResolvedValue({ data: "a".repeat(MAX_DOC_CHARS) });
    const res = await POST(jsonRequest({ fileId: "atcap", name: "At cap" }));
    expect(res.status).toBe(200);
    expect(startDocumentSummary).toHaveBeenCalledOnce();
  });

  it("requires either a file or a fileId", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });
});
