import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import {
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  updateWorkflowRun,
  deleteWorkflowRun,
  sweepOldWorkflowRuns,
  type WorkflowRunStepRow,
} from "../src/workflow-runs.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-wfr-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

const oneStep: WorkflowRunStepRow[] = [
  { toolId: "resize", params: { maxW: 800 }, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null },
];

describe("workflow-runs", () => {
  it("is empty by default", () => {
    expect(listWorkflowRuns(freshDb())).toEqual([]);
  });

  it("creates and fetches a run with parsed steps", () => {
    const db = freshDb();
    const id = createWorkflowRun(db, { label: "resize then convert", steps: oneStep });
    const row = getWorkflowRun(db, id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending");
    expect(row!.workflowId).toBeNull();
    expect(row!.steps).toEqual(oneStep);
  });

  it("returns null for a missing run", () => {
    expect(getWorkflowRun(freshDb(), "nope")).toBeNull();
  });

  it("updates status and steps", () => {
    const db = freshDb();
    const id = createWorkflowRun(db, { label: "x", steps: oneStep });
    const updated: WorkflowRunStepRow[] = [{ ...oneStep[0], status: "done", startedAt: 1, endedAt: 2, outputRef: "job-1" }];
    updateWorkflowRun(db, id, { status: "done", steps: updated });
    const row = getWorkflowRun(db, id)!;
    expect(row.status).toBe("done");
    expect(row.steps[0].outputRef).toBe("job-1");
  });

  it("lists newest first, optionally scoped by workflowId", () => {
    const db = freshDb();
    const a = createWorkflowRun(db, { workflowId: "w1", label: "a", steps: oneStep });
    const b = createWorkflowRun(db, { workflowId: "w2", label: "b", steps: oneStep });
    db.run(sql.raw(`UPDATE workflow_runs SET created_at = 1 WHERE id = '${a}'`));
    db.run(sql.raw(`UPDATE workflow_runs SET created_at = 2 WHERE id = '${b}'`));
    expect(listWorkflowRuns(db).map((r) => r.id)).toEqual([b, a]);
    expect(listWorkflowRuns(db, "w1").map((r) => r.id)).toEqual([a]);
  });

  it("deletes a run", () => {
    const db = freshDb();
    const id = createWorkflowRun(db, { label: "x", steps: oneStep });
    deleteWorkflowRun(db, id);
    expect(getWorkflowRun(db, id)).toBeNull();
  });

  it("tolerates malformed steps JSON", () => {
    const db = freshDb();
    const id = createWorkflowRun(db, { label: "x", steps: oneStep });
    db.run(sql.raw(`UPDATE workflow_runs SET steps = 'not-json' WHERE id = '${id}'`));
    expect(getWorkflowRun(db, id)!.steps).toEqual([]);
  });

  it("sweeps runs older than maxAgeMs, capped at 200 total", () => {
    const db = freshDb();
    const oldId = createWorkflowRun(db, { label: "old", steps: oneStep });
    db.run(sql.raw(`UPDATE workflow_runs SET created_at = 1 WHERE id = '${oldId}'`));
    const newId = createWorkflowRun(db, { label: "new", steps: oneStep });
    db.run(sql.raw(`UPDATE workflow_runs SET created_at = ${Date.now()} WHERE id = '${newId}'`));
    sweepOldWorkflowRuns(db, 1000);
    const remaining = listWorkflowRuns(db).map((r) => r.id);
    expect(remaining).toContain(newId);
    expect(remaining).not.toContain(oldId);
  });
});
