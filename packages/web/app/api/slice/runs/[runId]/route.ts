import { NextResponse } from "next/server";
import { deleteSliceRun } from "@event-editor/core/slice-runs";
import { getDb } from "@/lib/db";
import { cleanupRun } from "@/lib/slice";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  deleteSliceRun(getDb(), runId);
  try {
    await cleanupRun(runId);
  } catch {
    /* best-effort file cleanup */
  }
  return NextResponse.json({ ok: true });
}
