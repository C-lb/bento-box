import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, jobs } from "@event-editor/core";
import { eq } from "drizzle-orm";
import { startScan } from "../lib/sorter.js";

// Preflight now errors the job when the key is absent; set a dummy so the async
// pipeline runs to completion (the lone null-thumbnail photo errors, job -> done).
process.env.ANTHROPIC_API_KEY ??= "test-key";

function freshDb() {
  const path = join(tmpdir(), `ee-srt-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const fakeDrive = {
  async listFolders() { return [{ id: "f1", name: "A" }]; },
  async listImages() { return [{ id: "i1", name: "a.jpg", mimeType: "image/jpeg", thumbnailLink: null }]; },
  async downloadThumbnail() { return null; },
};

describe("startScan", () => {
  it("creates a job and returns its id immediately", async () => {
    const db = freshDb();
    const jobId = startScan(db, fakeDrive as any, { folderId: "f1", folderName: "A" });
    expect(typeof jobId).toBe("number");
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.driveFolderId).toBe("f1");
    // ingest runs async; give the microtask queue a tick
    await new Promise((r) => setTimeout(r, 20));
    const after = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(["scanning", "done"]).toContain(after.status);
  });
});
