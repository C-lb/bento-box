import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { workflows } from "./schema/index.js";

export interface WorkflowStepDef {
  toolId: string;
  params: Record<string, unknown>;
}

export interface WorkflowRow {
  id: string;
  name: string;
  steps: WorkflowStepDef[];
  createdAt: number;
  updatedAt: number;
}

function parseSteps(raw: string): WorkflowStepDef[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toRow(r: typeof workflows.$inferSelect): WorkflowRow {
  return { id: r.id, name: r.name, steps: parseSteps(r.steps), createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function createWorkflow(
  db: BetterSQLite3Database<any>,
  args: { name: string; steps: WorkflowStepDef[] },
): string {
  const id = randomUUID();
  const now = Date.now();
  db.insert(workflows)
    .values({ id, name: args.name, steps: JSON.stringify(args.steps), createdAt: now, updatedAt: now })
    .run();
  return id;
}

export function getWorkflow(db: BetterSQLite3Database<any>, id: string): WorkflowRow | null {
  const r = db.select().from(workflows).where(eq(workflows.id, id)).all()[0];
  return r ? toRow(r) : null;
}

export function listWorkflows(db: BetterSQLite3Database<any>): WorkflowRow[] {
  return db.select().from(workflows).orderBy(desc(workflows.updatedAt)).all().map(toRow);
}

export function renameWorkflow(db: BetterSQLite3Database<any>, id: string, name: string): void {
  db.update(workflows).set({ name, updatedAt: Date.now() }).where(eq(workflows.id, id)).run();
}

export function updateWorkflowSteps(db: BetterSQLite3Database<any>, id: string, steps: WorkflowStepDef[]): void {
  db.update(workflows).set({ steps: JSON.stringify(steps), updatedAt: Date.now() }).where(eq(workflows.id, id)).run();
}

export function deleteWorkflow(db: BetterSQLite3Database<any>, id: string): void {
  db.delete(workflows).where(eq(workflows.id, id)).run();
}
