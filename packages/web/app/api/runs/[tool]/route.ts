import { NextResponse } from "next/server";
import { listToolRuns, isToolRunTool } from "@event-editor/core/tool-runs";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Past runs for a jobDir-output tool (pdf|resize|video|splice|convert), newest
// first. Rows outlive the on-disk files (swept ~6h after conversion); the
// panel discloses that links expire.
export async function GET(_req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!isToolRunTool(tool)) return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
  return NextResponse.json({ runs: listToolRuns(getDb(), tool) });
}
