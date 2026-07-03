import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sliceRuns } from "./schema/index.js";

export interface SliceRunRow {
  runId: string;
  sourceFilename: string;
  status: string;
  createdAt: number;
}

export function createSliceRun(
  db: BetterSQLite3Database<any>,
  args: { runId: string; sourceFilename: string },
): void {
  db.insert(sliceRuns)
    .values({ runId: args.runId, sourceFilename: args.sourceFilename, status: "converted", createdAt: Date.now() })
    .onConflictDoNothing()
    .run();
}

export function markSliceRunSliced(db: BetterSQLite3Database<any>, runId: string): void {
  db.update(sliceRuns).set({ status: "sliced" }).where(eq(sliceRuns.runId, runId)).run();
}

export function listSliceRuns(db: BetterSQLite3Database<any>): SliceRunRow[] {
  return db.select().from(sliceRuns).orderBy(desc(sliceRuns.createdAt)).all();
}

export function deleteSliceRun(db: BetterSQLite3Database<any>, runId: string): void {
  db.delete(sliceRuns).where(eq(sliceRuns.runId, runId)).run();
}
