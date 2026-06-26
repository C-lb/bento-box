import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { jobs, photos } from "./schema/index.js";
import { scoreHeuristics, computeRanks, type ImageMetrics, type VisionScore } from "./rank.js";

export interface RankingPhoto {
  id: number;
  name: string;
  mimeType: string;
  thumbnailPath: string | null;
}

export interface RankingDeps {
  getMetrics(photo: RankingPhoto): Promise<ImageMetrics>;
  scoreVision(photo: RankingPhoto): Promise<VisionScore>;
}

function touch(db: BetterSQLite3Database<any>, jobId: number, set: Record<string, unknown>) {
  db.update(jobs).set({ ...set, updatedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
}

export async function runRanking(
  db: BetterSQLite3Database<any>,
  jobId: number,
  deps: RankingDeps,
): Promise<void> {
  try {
    touch(db, jobId, { status: "heuristics" });
    const pending = db
      .select()
      .from(photos)
      .where(eq(photos.jobId, jobId))
      .all()
      .filter((p) => p.stage === "pending");

    const survivors: RankingPhoto[] = [];
    for (const p of pending) {
      const photo: RankingPhoto = { id: p.id, name: p.name, mimeType: p.mimeType, thumbnailPath: p.thumbnailPath };
      if (!photo.thumbnailPath) {
        db.update(photos).set({ stage: "errored", errorMessage: "no thumbnail" }).where(eq(photos.id, p.id)).run();
        continue;
      }
      try {
        const m = await deps.getMetrics(photo);
        const verdict = scoreHeuristics(m);
        db.update(photos)
          .set({ width: m.width, height: m.height, sharpness: m.sharpness, brightness: m.brightness, aspectRatio: m.aspectRatio })
          .where(eq(photos.id, p.id))
          .run();
        if (verdict.rejected) {
          db.update(photos).set({ stage: "rejected", rejectReason: verdict.reason }).where(eq(photos.id, p.id)).run();
        } else {
          survivors.push(photo);
        }
      } catch (err) {
        db.update(photos).set({ stage: "errored", errorMessage: err instanceof Error ? err.message : String(err) }).where(eq(photos.id, p.id)).run();
      }
    }

    touch(db, jobId, { status: "ranking" });
    for (const photo of survivors) {
      try {
        const vs = await deps.scoreVision(photo);
        db.update(photos).set({ stage: "ranked", score: vs.score, reasons: vs.reasons }).where(eq(photos.id, photo.id)).run();
      } catch (err) {
        db.update(photos).set({ stage: "errored", errorMessage: err instanceof Error ? err.message : String(err) }).where(eq(photos.id, photo.id)).run();
      }
    }

    const all = db.select().from(photos).where(eq(photos.jobId, jobId)).all();
    for (const { id, rank } of computeRanks(all.map((p) => ({ id: p.id, score: p.score ?? null, stage: p.stage })))) {
      db.update(photos).set({ rank }).where(eq(photos.id, id)).run();
    }
    touch(db, jobId, { status: "done" });
  } catch (err) {
    touch(db, jobId, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
