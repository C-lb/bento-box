import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import { createSliceRun, markSliceRunSliced, listSliceRuns, deleteSliceRun } from "../src/slice-runs.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-sr-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("slice-runs", () => {
  it("is empty by default", () => {
    expect(listSliceRuns(freshDb())).toEqual([]);
  });
  it("creates a run with status converted and lists it", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "r1", sourceFilename: "deck.pptx" });
    const rows = listSliceRuns(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: "r1", sourceFilename: "deck.pptx", status: "converted" });
  });
  it("marks a run sliced", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "r1", sourceFilename: "deck.pptx" });
    markSliceRunSliced(db, "r1");
    expect(listSliceRuns(db)[0].status).toBe("sliced");
  });
  it("orders newest first by createdAt", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "old", sourceFilename: "a.pptx" });
    createSliceRun(db, { runId: "new", sourceFilename: "b.pptx" });
    // both get Date.now(); force a deterministic ordering by bumping created_at
    db.run(sql.raw("UPDATE slice_runs SET created_at = 1 WHERE run_id = 'old'"));
    db.run(sql.raw("UPDATE slice_runs SET created_at = 2 WHERE run_id = 'new'"));
    expect(listSliceRuns(db).map((r) => r.runId)).toEqual(["new", "old"]);
  });
  it("deletes a run", () => {
    const db = freshDb();
    createSliceRun(db, { runId: "r1", sourceFilename: "deck.pptx" });
    deleteSliceRun(db, "r1");
    expect(listSliceRuns(db)).toEqual([]);
  });
});
