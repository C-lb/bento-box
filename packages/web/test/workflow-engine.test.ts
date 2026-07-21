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

describe("retryWorkflowFrom", () => {
  it("rehydrates the prior step's persisted output as input, re-runs the failed step, and finishes done", async () => {
    const stepA: StepAdapter<{ n: number }, {}, { n: number }> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async (input) => ({ n: input.n + 1 }),
    };
    const buggyStepB: StepAdapter<any, any, any> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async () => {
        throw new Error("boom");
      },
    };
    vi.resetModules();
    vi.doMock("../lib/workflow/registry.js", () => ({ STEP_REGISTRY: { a: stepA, b: buggyStepB } }));
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
    let row = getWorkflowRun(db, runId)!;
    expect(row.status).toBe("error");
    expect(row.steps[0].status).toBe("done");
    expect(JSON.parse(row.steps[0].outputRef!)).toEqual({ kind: "generic", value: { n: 2 } });
    const staleErrorMessage = row.steps[1].errorMessage;
    expect(staleErrorMessage).toBe("boom");
    const staleStartedAt = row.steps[1].startedAt;
    expect(staleStartedAt).not.toBeNull();

    // Fix step b via a corrected adapter, then retry from the failed step index.
    const fixedStepB: StepAdapter<{ n: number }, {}, { n: number }> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async (input) => ({ n: input.n * 10 }),
    };
    vi.resetModules();
    vi.doMock("../lib/workflow/registry.js", () => ({ STEP_REGISTRY: { a: stepA, b: fixedStepB } }));
    const { retryWorkflowFrom } = await import("../lib/workflow/engine.js");

    await retryWorkflowFrom(db, runId, 1);
    row = getWorkflowRun(db, runId)!;
    expect(row.status).toBe("done");
    // Step 0 (untouched by the retry) still holds its original persisted output.
    expect(JSON.parse(row.steps[0].outputRef!)).toEqual({ kind: "generic", value: { n: 2 } });
    // Step 1 was rehydrated from step 0's output (n=2) and re-run with the fixed adapter (n*10=20),
    // not left with stale data from the original failed run.
    expect(row.steps[1].status).toBe("done");
    expect(row.steps[1].errorMessage).toBeNull();
    expect(row.steps[1].errorMessage).not.toBe(staleErrorMessage);
    expect(JSON.parse(row.steps[1].outputRef!)).toEqual({ kind: "generic", value: { n: 20 } });
  });

  it("throws when retrying from step 0 without a fresh input", async () => {
    const stepA: StepAdapter<any, any, any> = { inputKind: "file", outputKind: "file", paramsSchema: {}, run: async (i) => i };
    vi.resetModules();
    vi.doMock("../lib/workflow/registry.js", () => ({ STEP_REGISTRY: { a: stepA } }));
    const { retryWorkflowFrom } = await import("../lib/workflow/engine.js");

    const db = freshDb();
    const runId = createWorkflowRun(db, {
      label: "test",
      steps: [{ toolId: "a", params: {}, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null }],
    });

    await expect(retryWorkflowFrom(db, runId, 0)).rejects.toThrow("retrying from step 0 requires a fresh input");
  });

  it("re-runs the whole chain from scratch when retrying from step 0 with a fresh input", async () => {
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
    const { runWorkflow, retryWorkflowFrom } = await import("../lib/workflow/engine.js");

    const db = freshDb();
    const runId = createWorkflowRun(db, {
      label: "test",
      steps: [
        { toolId: "a", params: {}, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null },
        { toolId: "b", params: {}, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null },
      ],
    });

    await runWorkflow(db, runId, { n: 1 });
    let row = getWorkflowRun(db, runId)!;
    expect(JSON.parse(row.steps[1].outputRef!)).toEqual({ kind: "generic", value: { n: 20 } });
    const staleOutputRef = row.steps[0].outputRef;

    await retryWorkflowFrom(db, runId, 0, { n: 5 });
    row = getWorkflowRun(db, runId)!;
    expect(row.status).toBe("done");
    // Step 0 was reset to pending and re-run with the fresh input, not left with the stale output.
    expect(row.steps[0].outputRef).not.toBe(staleOutputRef);
    expect(JSON.parse(row.steps[0].outputRef!)).toEqual({ kind: "generic", value: { n: 6 } });
    expect(JSON.parse(row.steps[1].outputRef!)).toEqual({ kind: "generic", value: { n: 60 } });
  });

  it("resets steps from the retry index onward to pending before re-running them", async () => {
    const stepA: StepAdapter<{ n: number }, {}, { n: number }> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async (input) => ({ n: input.n + 1 }),
    };
    const buggyStepB: StepAdapter<any, any, any> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async () => {
        throw new Error("boom");
      },
    };
    vi.resetModules();
    vi.doMock("../lib/workflow/registry.js", () => ({ STEP_REGISTRY: { a: stepA, b: buggyStepB } }));
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
    let row = getWorkflowRun(db, runId)!;
    expect(row.steps[1].status).toBe("error");
    expect(row.steps[1].errorMessage).toBe("boom");
    expect(row.steps[1].endedAt).not.toBeNull();

    const fixedStepB: StepAdapter<{ n: number }, {}, { n: number }> = {
      inputKind: "file",
      outputKind: "file",
      paramsSchema: {},
      run: async (input) => ({ n: input.n * 10 }),
    };
    vi.resetModules();
    vi.doMock("../lib/workflow/registry.js", () => ({ STEP_REGISTRY: { a: stepA, b: fixedStepB } }));
    const { retryWorkflowFrom } = await import("../lib/workflow/engine.js");

    await retryWorkflowFrom(db, runId, 1);
    row = getWorkflowRun(db, runId)!;
    // The retried step's error state was cleared (reset to pending) before being re-run to done —
    // it does not retain the stale errorMessage/outputRef from the failed run.
    expect(row.steps[1].status).toBe("done");
    expect(row.steps[1].errorMessage).toBeNull();
    expect(row.steps[1].startedAt).not.toBeNull();
    expect(row.steps[1].endedAt).not.toBeNull();
    expect(JSON.parse(row.steps[1].outputRef!)).toEqual({ kind: "generic", value: { n: 20 } });
  });
});
