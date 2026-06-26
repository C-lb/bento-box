import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, jobs, photos, createScanJob, runRanking } from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-rank-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

function seedPhoto(db: any, jobId: number, over: Record<string, unknown>) {
  db.insert(photos).values({
    jobId, driveFileId: "f", name: "p.jpg", mimeType: "image/jpeg",
    stage: "pending", thumbnailPath: "data/thumbs/x/1.jpg", ...over,
  }).run();
}

const goodMetrics = { width: 800, height: 800, sharpness: 300, brightness: 130, aspectRatio: 1 };
const blurMetrics = { width: 800, height: 800, sharpness: 5, brightness: 130, aspectRatio: 1 };

describe("runRanking", () => {
  it("rejects junk, scores survivors, assigns ranks, marks done", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f", driveFolderName: "F" });
    seedPhoto(db, jobId, { name: "good1.jpg" });   // id 1
    seedPhoto(db, jobId, { name: "blurry.jpg" });  // id 2
    seedPhoto(db, jobId, { name: "good2.jpg" });   // id 3
    seedPhoto(db, jobId, { name: "nothumb.jpg", thumbnailPath: null }); // id 4

    let scoreCalls = 0;
    await runRanking(db, jobId, {
      getMetrics: async (p: any) => (p.name === "blurry.jpg" ? blurMetrics : goodMetrics),
      scoreVision: async (p: any) => { scoreCalls++; return { score: p.name === "good2.jpg" ? 90 : 70, reasons: ["ok"] }; },
    });

    const rows = db.select().from(photos).where(eq(photos.jobId, jobId)).all().sort((a: any, b: any) => a.id - b.id);
    expect(rows[0].stage).toBe("ranked");
    expect(rows[1].stage).toBe("rejected");
    expect(rows[1].rejectReason).toMatch(/blur/i);
    expect(rows[2].stage).toBe("ranked");
    expect(rows[3].stage).toBe("errored");
    expect(scoreCalls).toBe(2); // only the two good photos reach vision
    // good2 (90) outranks good1 (70)
    expect(rows.find((r: any) => r.name === "good2.jpg")!.rank).toBe(1);
    expect(rows.find((r: any) => r.name === "good1.jpg")!.rank).toBe(2);

    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("done");
  });

  it("marks a photo errored when vision throws but still finishes the job", async () => {
    const db = freshDb();
    const jobId = createScanJob(db, { driveFolderId: "f", driveFolderName: "F" });
    seedPhoto(db, jobId, { name: "boom.jpg" });
    await runRanking(db, jobId, {
      getMetrics: async () => goodMetrics,
      scoreVision: async () => { throw new Error("api down"); },
    });
    const row = db.select().from(photos).where(eq(photos.jobId, jobId)).all()[0];
    expect(row.stage).toBe("errored");
    expect(row.errorMessage).toMatch(/api down/);
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    expect(job.status).toBe("done");
  });
});
