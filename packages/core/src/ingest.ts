import { eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { jobs, photos } from "./schema/index.js";

export interface IngestImage {
  id: string;
  name: string;
  mimeType: string;
}

export interface IngestDeps {
  listImages(folderId: string): Promise<IngestImage[]>;
  saveThumbnail(jobId: number, photoId: number, image: IngestImage): Promise<string | null>;
}

export function createScanJob(
  db: BetterSQLite3Database<any>,
  args: { driveFolderId: string; driveFolderName: string },
): number {
  const now = Date.now();
  const res = db
    .insert(jobs)
    .values({
      driveFolderId: args.driveFolderId,
      driveFolderName: args.driveFolderName,
      status: "scanning",
      total: 0,
      processed: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

function touch(db: BetterSQLite3Database<any>, jobId: number, set: Record<string, unknown>) {
  db.update(jobs).set({ ...set, updatedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
}

export async function runIngest(
  db: BetterSQLite3Database<any>,
  jobId: number,
  folderId: string,
  deps: IngestDeps,
  opts?: { completeStatus?: "done" | "heuristics" },
): Promise<void> {
  try {
    const images = await deps.listImages(folderId);
    touch(db, jobId, { total: images.length });
    for (const img of images) {
      const res = db
        .insert(photos)
        .values({
          jobId,
          driveFileId: img.id,
          name: img.name,
          mimeType: img.mimeType,
          stage: "pending",
        })
        .run();
      const photoId = Number(res.lastInsertRowid);
      const thumbPath = await deps.saveThumbnail(jobId, photoId, img);
      if (thumbPath) {
        db.update(photos).set({ thumbnailPath: thumbPath }).where(eq(photos.id, photoId)).run();
      }
      db.update(jobs)
        .set({ processed: sql`${jobs.processed} + 1`, updatedAt: Date.now() })
        .where(eq(jobs.id, jobId))
        .run();
    }
    touch(db, jobId, { status: opts?.completeStatus ?? "done" });
  } catch (err) {
    touch(db, jobId, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}
