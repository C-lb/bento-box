import { NextResponse } from "next/server";
import { visionClient } from "@/lib/anthropic";
import { synthesizeParams } from "@/lib/workflow/plan";
import { STEP_REGISTRY } from "@/lib/workflow/registry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const toolId = typeof body?.toolId === "string" ? body.toolId.trim() : "";
  const instructionText = typeof body?.instructionText === "string" ? body.instructionText.trim() : "";
  if (!toolId || !instructionText) {
    return NextResponse.json({ error: "toolId and instructionText are required" }, { status: 400 });
  }

  const adapter = STEP_REGISTRY[toolId];
  if (!adapter) return NextResponse.json({ error: `unknown toolId "${toolId}"` }, { status: 400 });

  const client = visionClient();
  const params = await synthesizeParams(client, toolId, instructionText, adapter.paramsSchema);
  return NextResponse.json({ params });
}
