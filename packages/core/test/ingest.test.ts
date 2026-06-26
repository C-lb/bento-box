import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, jobs, photos, createScanJob, runIngest } from "../src/index.js";
import { eq } from "drizzle-orm";

function freshDb() {
  const path = join(tmpdir(), `ee-ing-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const deps = (imgs: any[]) => ({
  listImages: async () => imgs,
  saveThumbnail: async (_j: number, p: number) => `data/thumbs/x/${p}.jpg`,
});

describe("runIngest", () => {
  it("ingests images, writes photos, marks job done", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f1", driveFolderName: "Folder" });
    await runIngest(db, jobId, "f1", deps([
      { id: "i1", name: "a.jpg", mimeType: "image/jpeg" },
      { id: "i2", name: "b.png", mimeType: "image/png" },
    ]));
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("done");
    expect(job.total).toBe(2);
    expect(job.processed).toBe(2);
    const rows = db.select().from(photos).where(eq(photos.jobId, jobId)).all();
    expect(rows).toHaveLength(2);
    expect(rows[0].stage).toBe("pending");
    expect(rows[0].thumbnailPath).toContain("data/thumbs");
  });

  it("empty folder finishes done with total 0", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f1", driveFolderName: "Empty" });
    await runIngest(db, jobId, "f1", deps([]));
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("done");
    expect(job.total).toBe(0);
  });

  it("marks job error when listing throws", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f1", driveFolderName: "Boom" });
    await runIngest(db, jobId, "f1", {
      listImages: async () => { throw new Error("drive down"); },
      saveThumbnail: async () => null,
    });
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("error");
    expect(job.errorMessage).toContain("drive down");
  });
});
