import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, jobs, photos } from "@event-editor/core";

// Mock the image + vision deps so the pipeline is deterministic and offline.
vi.mock("../lib/metrics.js", () => ({
  computeMetrics: async () => ({ width: 800, height: 800, sharpness: 300, brightness: 130, aspectRatio: 1 }),
}));
vi.mock("../lib/anthropic.js", () => ({
  visionClient: () => ({}),
  scorePhoto: async () => ({ score: 88, reasons: ["clear face"] }),
}));
// startScan re-encodes thumbnails through sharp; stub it so the fake 4-byte
// "thumbnail" doesn't need to be a decodable image.
vi.mock("sharp", () => ({
  default: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from([1, 2, 3, 4]) }) }),
}));
// Preflight requires the key to be present (value is irrelevant — anthropic is mocked).
process.env.ANTHROPIC_API_KEY ??= "test-key";

const { startScan } = await import("../lib/sorter.js");

function freshDb() {
  const path = join(tmpdir(), `ee-pipe-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

describe("scan pipeline (ingest -> ranking)", () => {
  it("ingests then ranks to done", async () => {
    const db = freshDb();
    // a fake Drive client that returns one image and writes a real thumbnail file
    const thumbDir = join(tmpdir(), `ee-thumbs-${Math.random().toString(36).slice(2)}`);
    mkdirSync(thumbDir, { recursive: true });
    const thumbBytes = Buffer.from([1, 2, 3, 4]);
    const drive = {
      async listFolders() { return [{ id: "f1", name: "A" }]; },
      async listImages() { return [{ id: "i1", name: "a.jpg", mimeType: "image/jpeg", thumbnailLink: "t" }]; },
      async downloadThumbnail() { return thumbBytes; },
    };
    const jobId = startScan(db, drive as any, { folderId: "f1", folderName: "A", platform: "linkedin" });
    // wait for the async pipeline to finish
    for (let i = 0; i < 50; i++) {
      const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
      if (job.status === "done" || job.status === "error") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("done");
    const row = db.select().from(photos).where(eq(photos.jobId, jobId)).all()[0];
    expect(row.stage).toBe("ranked");
    expect(row.score).toBe(88);
    expect(row.rank).toBe(1);
  });
});
