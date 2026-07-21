import { NextResponse } from "next/server";
import { getWorkflowRun, updateWorkflowRun } from "@event-editor/core";
import { getDb } from "@/lib/db";
import { retryWorkflowFrom } from "@/lib/workflow/engine";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const db = getDb();
  const run = getWorkflowRun(db, runId);
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const stepIndex = Number(body?.stepIndex);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= run.steps.length) {
    return NextResponse.json({ error: "valid stepIndex is required" }, { status: 400 });
  }
  if (stepIndex === 0 && body?.freshFirstInput === undefined) {
    return NextResponse.json({ error: "freshFirstInput is required when retrying from step 0" }, { status: 400 });
  }

  void retryWorkflowFrom(db, runId, stepIndex, body?.freshFirstInput).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    updateWorkflowRun(db, runId, { status: "error" });
    console.error(`workflow retry ${runId} failed unexpectedly:`, message);
  });
  return NextResponse.json({ ok: true });
}
