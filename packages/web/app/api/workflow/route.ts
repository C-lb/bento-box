import { NextResponse } from "next/server";
import { createWorkflow, listWorkflows } from "@event-editor/core";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ workflows: listWorkflows(getDb()) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const steps = Array.isArray(body?.steps) ? body.steps : null;
  if (!name || !steps) return NextResponse.json({ error: "name and steps[] are required" }, { status: 400 });
  const id = createWorkflow(getDb(), { name, steps });
  return NextResponse.json({ id });
}
