import { NextResponse } from "next/server";
import { deleteToolRun, isToolRunTool } from "@event-editor/core/tool-runs";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ tool: string; id: string }> }) {
  const { tool, id } = await params;
  if (!isToolRunTool(tool)) return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
  deleteToolRun(getDb(), tool, id);
  return NextResponse.json({ ok: true });
}
