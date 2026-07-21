import { NextResponse } from "next/server";
import { getWorkflow, createWorkflowRun } from "@event-editor/core";
import { getDb } from "@/lib/db";
import { runWorkflow } from "@/lib/workflow/engine";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const workflow = getWorkflow(db, id);
  if (!workflow) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (body?.firstInput === undefined) return NextResponse.json({ error: "firstInput is required" }, { status: 400 });

  const runId = createWorkflowRun(db, {
    workflowId: id,
    label: workflow.name,
    steps: workflow.steps.map((s) => ({
      toolId: s.toolId,
      params: s.params,
      status: "pending" as const,
      startedAt: null,
      endedAt: null,
      outputRef: null,
      errorMessage: null,
    })),
  });

  void runWorkflow(db, runId, body.firstInput);
  return NextResponse.json({ runId });
}
