import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { workflowRuns } from "./schema/index.js";

export type WorkflowRunStatus = "pending" | "running" | "done" | "error";

export interface WorkflowRunStepRow {
  toolId: string;
  params: Record<string, unknown>;
  status: WorkflowRunStatus;
  startedAt: number | null;
  endedAt: number | null;
  outputRef: string | null;
  errorMessage: string | null;
}

export interface WorkflowRunRow {
  id: string;
  workflowId: string | null;
  label: string;
  status: WorkflowRunStatus;
  steps: WorkflowRunStepRow[];
  createdAt: number;
  updatedAt: number;
}

const MAX_RUNS = 200;

function parseSteps(raw: string): WorkflowRunStepRow[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toRow(r: typeof workflowRuns.$inferSelect): WorkflowRunRow {
  return {
    id: r.id,
    workflowId: r.workflowId,
    label: r.label,
    status: r.status as WorkflowRunStatus,
    steps: parseSteps(r.steps),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function createWorkflowRun(
  db: BetterSQLite3Database<any>,
  args: { workflowId?: string | null; label: string; steps: WorkflowRunStepRow[] },
): string {
  const id = randomUUID();
  const now = Date.now();
  db.insert(workflowRuns)
    .values({
      id,
      workflowId: args.workflowId ?? null,
      label: args.label,
      status: "pending",
      steps: JSON.stringify(args.steps),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function getWorkflowRun(db: BetterSQLite3Database<any>, id: string): WorkflowRunRow | null {
  const r = db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).all()[0];
  return r ? toRow(r) : null;
}

export function listWorkflowRuns(db: BetterSQLite3Database<any>, workflowId?: string | null): WorkflowRunRow[] {
  const rows = workflowId
    ? db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId)).orderBy(desc(workflowRuns.createdAt), desc(sql`rowid`)).all()
    : db.select().from(workflowRuns).orderBy(desc(workflowRuns.createdAt), desc(sql`rowid`)).all();
  return rows.map(toRow);
}

export function updateWorkflowRun(
  db: BetterSQLite3Database<any>,
  id: string,
  patch: { status?: WorkflowRunStatus; steps?: WorkflowRunStepRow[] },
): void {
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.status) set.status = patch.status;
  if (patch.steps) set.steps = JSON.stringify(patch.steps);
  db.update(workflowRuns).set(set).where(eq(workflowRuns.id, id)).run();
}

export function deleteWorkflowRun(db: BetterSQLite3Database<any>, id: string): void {
  db.delete(workflowRuns).where(eq(workflowRuns.id, id)).run();
}

export function sweepOldWorkflowRuns(db: BetterSQLite3Database<any>, maxAgeMs: number): void {
  const cutoff = Date.now() - maxAgeMs;
  db.delete(workflowRuns).where(sql`${workflowRuns.createdAt} < ${cutoff}`).run();
  db.run(sql`DELETE FROM workflow_runs WHERE id NOT IN (
    SELECT id FROM workflow_runs ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_RUNS}
  )`);
}
