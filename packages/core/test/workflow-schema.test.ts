import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, workflows, workflowRuns } from "../src/index.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-wf-schema-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("workflow schema", () => {
  it("round-trips a workflows row", () => {
    const db = freshDb();
    db.insert(workflows)
      .values({ id: "w1", name: "Slice + stamp", steps: "[]", createdAt: 1, updatedAt: 1 })
      .run();
    const rows = db.select().from(workflows).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "w1", name: "Slice + stamp", steps: "[]" });
  });

  it("round-trips a workflow_runs row with a null workflowId", () => {
    const db = freshDb();
    db.insert(workflowRuns)
      .values({ id: "r1", workflowId: null, label: "slice deck", status: "pending", steps: "[]", createdAt: 1, updatedAt: 1 })
      .run();
    const rows = db.select().from(workflowRuns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].workflowId).toBeNull();
    expect(rows[0].status).toBe("pending");
  });

  it("is idempotent when migrations run twice", () => {
    const db = freshDb();
    expect(() => runMigrations(db)).not.toThrow();
  });
});
