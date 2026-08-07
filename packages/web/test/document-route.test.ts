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

  it("requires either a file or a fileId", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });
});
