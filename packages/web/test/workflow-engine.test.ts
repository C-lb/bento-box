import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, createWorkflowRun, getWorkflowRun } from "@event-editor/core";
import type { StepAdapter } from "../lib/workflow/types.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-wf-engine-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("runWorkflow", () => {
  it("runs every step, feeding each output into the next input, and marks the run done", async () => {
    const stepA: StepAdapter<{ n: number }, {}, { n: number }> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async (input) => ({ n: input.n + 1 }),
    };
    const stepB: StepAdapter<{ n: number }, {}, { n: number }> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async (input) => ({ n: input.n * 10 }),
    };
    vi.resetModules();
    vi.doMock("../lib/workflow/registry.js", () => ({ STEP_REGISTRY: { a: stepA, b: stepB } }));
    const { runWorkflow } = await import("../lib/workflow/engine.js");

    const db = freshDb();
    const runId = createWorkflowRun(db, {
      label: "test",
      steps: [
        { toolId: "a", params: {}, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null },
        { toolId: "b", params: {}, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null },
      ],
    });

    await runWorkflow(db, runId, { n: 1 });
    const row = getWorkflowRun(db, runId)!;
    expect(row.status).toBe("done");
    expect(row.steps.every((s) => s.status === "done")).toBe(true);
    expect(JSON.parse(row.steps[1].outputRef!)).toEqual({ kind: "generic", value: { n: 20 } });
  });

  it("halts on the first error, leaving later steps pending", async () => {
    const failing: StepAdapter<any, any, any> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async () => {
        throw new Error("boom");
      },
    };
    const untouched: StepAdapter<any, any, any> = { inputKind: "file", outputKind: "file", paramsSchema: {}, run: async (i) => i };
    vi.resetModules();
    vi.doMock("../lib/workflow/registry.js", () => ({ STEP_REGISTRY: { fail: failing, ok: untouched } }));
    const { runWorkflow } = await import("../lib/workflow/engine.js");

    const db = freshDb();
    const runId = createWorkflowRun(db, {
      label: "test",
      steps: [
        { toolId: "fail", params: {}, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null },
        { toolId: "ok", params: {}, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null },
      ],
    });

    await runWorkflow(db, runId, {});
    const row = getWorkflowRun(db, runId)!;
    expect(row.status).toBe("error");
    expect(row.steps[0].status).toBe("error");
    expect(row.steps[0].errorMessage).toBe("boom");
    expect(row.steps[1].status).toBe("pending");
  });
});
