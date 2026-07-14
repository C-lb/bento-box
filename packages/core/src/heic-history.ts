import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { heicConversions } from "./schema/index.js";

export interface HeicConversionRow {
  id: number;
  batchId: string;
  jobId: string;
  sourceFilename: string;
  outFilename: string;
  outFormat: string;
  createdAt: number;
}

export interface HeicBatch {
  batchId: string;
  createdAt: number;
  items: Array<Pick<HeicConversionRow, "id" | "jobId" | "sourceFilename" | "outFilename" | "outFormat">>;
}

export function recordHeicConversion(
  db: BetterSQLite3Database<any>,
  args: { batchId: string; jobId: string; sourceFilename: string; outFilename: string; outFormat: string },
): void {
  db.insert(heicConversions).values({ ...args, createdAt: Date.now() }).run();
}

// Newest batch first; items keep their conversion order within a batch.
export function listHeicBatches(db: BetterSQLite3Database<any>, limit = 50): HeicBatch[] {
  const rows = db.select().from(heicConversions).orderBy(desc(heicConversions.createdAt)).all() as HeicConversionRow[];
  const byBatch = new Map<string, HeicBatch>();
  for (const r of rows) {
    let b = byBatch.get(r.batchId);
    if (!b) {
      b = { batchId: r.batchId, createdAt: r.createdAt, items: [] };
      byBatch.set(r.batchId, b);
    }
    b.items.push({ id: r.id, jobId: r.jobId, sourceFilename: r.sourceFilename, outFilename: r.outFilename, outFormat: r.outFormat });
    b.createdAt = Math.max(b.createdAt, r.createdAt);
  }
  return [...byBatch.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export function deleteHeicBatch(db: BetterSQLite3Database<any>, batchId: string): void {
  db.delete(heicConversions).where(eq(heicConversions.batchId, batchId)).run();
}
