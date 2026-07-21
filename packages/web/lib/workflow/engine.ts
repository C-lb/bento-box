import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getWorkflowRun, updateWorkflowRun, type WorkflowRunStepRow } from "@event-editor/core";
import { STEP_REGISTRY } from "./registry";

export interface OutputRef {
  kind: string;
  value: unknown;
}

async function runFrom(db: BetterSQLite3Database<any>, runId: string, startIndex: number, firstInput: unknown): Promise<void> {
  const row = getWorkflowRun(db, runId);
  if (!row) throw new Error(`workflow run ${runId} not found`);

  updateWorkflowRun(db, runId, { status: "running" });
  const steps = row.steps.slice();
  let input: unknown = firstInput;

  for (let i = 0; i < steps.length; i++) {
    if (i < startIndex) continue; // already-done steps before a retry point
    const step = steps[i];
    const adapter = STEP_REGISTRY[step.toolId];
    if (!adapter) {
      steps[i] = { ...step, status: "error", errorMessage: `unknown tool "${step.toolId}"` };
      updateWorkflowRun(db, runId, { status: "error", steps });
      return;
    }

    steps[i] = { ...step, status: "running", startedAt: Date.now() };
    updateWorkflowRun(db, runId, { steps });

    try {
      const output = await adapter.run(input, step.params);
      const outputRef: OutputRef = { kind: "generic", value: output };
      steps[i] = { ...steps[i], status: "done", endedAt: Date.now(), outputRef: JSON.stringify(outputRef) };
      updateWorkflowRun(db, runId, { steps });
      input = output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      steps[i] = { ...steps[i], status: "error", endedAt: Date.now(), errorMessage: message };
      updateWorkflowRun(db, runId, { status: "error", steps });
      return;
    }
  }

  updateWorkflowRun(db, runId, { status: "done", steps });
}

export async function runWorkflow(db: BetterSQLite3Database<any>, runId: string, firstInput: unknown): Promise<void> {
  return runFrom(db, runId, 0, firstInput);
}

export async function retryWorkflowFrom(
  db: BetterSQLite3Database<any>,
  runId: string,
  stepIndex: number,
  freshFirstInput?: unknown,
): Promise<void> {
  const row = getWorkflowRun(db, runId);
  if (!row) throw new Error(`workflow run ${runId} not found`);

  const steps: WorkflowRunStepRow[] = row.steps.map((s, i) =>
    i >= stepIndex ? { ...s, status: "pending", startedAt: null, endedAt: null, outputRef: null, errorMessage: null } : s,
  );
  updateWorkflowRun(db, runId, { steps });

  let input: unknown;
  if (stepIndex === 0) {
    if (freshFirstInput === undefined) throw new Error("retrying from step 0 requires a fresh input");
    input = freshFirstInput;
  } else {
    const prevRef = row.steps[stepIndex - 1].outputRef;
    if (!prevRef) throw new Error(`step ${stepIndex - 1} has no persisted output to resume from`);
    input = (JSON.parse(prevRef) as OutputRef).value;
  }
  return runFrom(db, runId, stepIndex, input);
}
