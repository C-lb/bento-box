import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { toolRuns } from "./schema/index.js";

// Tools whose runs live in the shared tool_runs table ("See past …" panels).
export const TOOL_RUN_TOOLS = ["pdf", "resize", "video", "splice", "convert"] as const;
export type ToolRunTool = (typeof TOOL_RUN_TOOLS)[number];

export function isToolRunTool(tool: string): tool is ToolRunTool {
  return (TOOL_RUN_TOOLS as readonly string[]).includes(tool);
}

export interface ToolRunOutput {
  id: string;
  filename: string;
}

export interface ToolRunRow {
  id: string;
  tool: string;
  label: string;
  mode: string | null;
  outputs: ToolRunOutput[];
  createdAt: number;
}

// History rows are metadata only (the files still die at the 6h sweep), so a
// hard cap per tool keeps the table from growing forever.
const MAX_RUNS_PER_TOOL = 50;

export function createToolRun(
  db: BetterSQLite3Database<any>,
  args: { tool: ToolRunTool; label: string; mode?: string | null; outputs: ToolRunOutput[] },
): string {
  const id = randomUUID();
  db.insert(toolRuns)
    .values({
      id,
      tool: args.tool,
      label: args.label,
      mode: args.mode ?? null,
      outputs: JSON.stringify(args.outputs),
      createdAt: Date.now(),
    })
    .run();
  // Prune to the newest 50 rows for this tool. rowid DESC breaks created_at
  // ties in favour of the most recent insert.
  db.run(sql`DELETE FROM tool_runs WHERE tool = ${args.tool} AND id NOT IN (
    SELECT id FROM tool_runs WHERE tool = ${args.tool}
    ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_RUNS_PER_TOOL}
  )`);
  return id;
}

// Newest first. Malformed outputs JSON degrades to an empty list rather than throwing.
export function listToolRuns(db: BetterSQLite3Database<any>, tool: ToolRunTool): ToolRunRow[] {
  const rows = db
    .select()
    .from(toolRuns)
    .where(eq(toolRuns.tool, tool))
    .orderBy(desc(toolRuns.createdAt), desc(sql`rowid`))
    .all();
  return rows.map((r) => {
    let outputs: ToolRunOutput[] = [];
    try {
      const parsed = JSON.parse(r.outputs);
      if (Array.isArray(parsed)) outputs = parsed;
    } catch {
      /* tolerate bad rows */
    }
    return { id: r.id, tool: r.tool, label: r.label, mode: r.mode, outputs, createdAt: r.createdAt };
  });
}

export function deleteToolRun(db: BetterSQLite3Database<any>, tool: ToolRunTool, id: string): void {
  db.delete(toolRuns).where(and(eq(toolRuns.tool, tool), eq(toolRuns.id, id))).run();
}
