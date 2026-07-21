import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  renameWorkflow,
  updateWorkflowSteps,
  deleteWorkflow,
  type WorkflowStepDef,
} from "../src/workflows.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-wf-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

const steps: WorkflowStepDef[] = [
  { toolId: "slice", params: { by: "speaker" } },
  { toolId: "pdf", params: { mode: "compress" } },
];

describe("workflows", () => {
  it("is empty by default", () => {
    expect(listWorkflows(freshDb())).toEqual([]);
  });

  it("creates and fetches a workflow with parsed steps", () => {
    const db = freshDb();
    const id = createWorkflow(db, { name: "Slice + compress", steps });
    const row = getWorkflow(db, id);
    expect(row).not.toBeNull();
    expect(row!.name).toBe("Slice + compress");
    expect(row!.steps).toEqual(steps);
  });

  it("returns null for a missing workflow", () => {
    expect(getWorkflow(freshDb(), "nope")).toBeNull();
  });

  it("renames a workflow", () => {
    const db = freshDb();
    const id = createWorkflow(db, { name: "old name", steps });
    renameWorkflow(db, id, "new name");
    expect(getWorkflow(db, id)!.name).toBe("new name");
  });

  it("updates steps", () => {
    const db = freshDb();
    const id = createWorkflow(db, { name: "x", steps });
    const next: WorkflowStepDef[] = [{ toolId: "convert", params: { output: "html" } }];
    updateWorkflowSteps(db, id, next);
    expect(getWorkflow(db, id)!.steps).toEqual(next);
  });

  it("lists newest-updated first", () => {
    const db = freshDb();
    const a = createWorkflow(db, { name: "a", steps });
    const b = createWorkflow(db, { name: "b", steps });
    db.run(sql.raw(`UPDATE workflows SET updated_at = 1 WHERE id = '${a}'`));
    db.run(sql.raw(`UPDATE workflows SET updated_at = 2 WHERE id = '${b}'`));
    expect(listWorkflows(db).map((r) => r.id)).toEqual([b, a]);
  });

  it("deletes a workflow", () => {
    const db = freshDb();
    const id = createWorkflow(db, { name: "x", steps });
    deleteWorkflow(db, id);
    expect(getWorkflow(db, id)).toBeNull();
  });

  it("tolerates malformed steps JSON, degrading to empty list", () => {
    const db = freshDb();
    const id = createWorkflow(db, { name: "x", steps });
    db.run(sql.raw(`UPDATE workflows SET steps = 'not-json' WHERE id = '${id}'`));
    expect(getWorkflow(db, id)!.steps).toEqual([]);
  });
});
