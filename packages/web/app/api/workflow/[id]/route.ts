import { NextResponse } from "next/server";
import { getWorkflow, renameWorkflow, updateWorkflowSteps, deleteWorkflow } from "@event-editor/core";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workflow = getWorkflow(getDb(), id);
  if (!workflow) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ workflow });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  if (!getWorkflow(db, id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (typeof body?.name === "string" && body.name.trim()) renameWorkflow(db, id, body.name.trim());
  if (Array.isArray(body?.steps)) updateWorkflowSteps(db, id, body.steps);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteWorkflow(getDb(), id);
  return NextResponse.json({ ok: true });
}
