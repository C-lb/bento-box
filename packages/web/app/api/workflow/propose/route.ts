import { NextResponse } from "next/server";
import { visionClient } from "@/lib/anthropic";
import { proposeChain, synthesizeParams } from "@/lib/workflow/plan";
import { STEP_REGISTRY } from "@/lib/workflow/registry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
  if (!goal) return NextResponse.json({ error: "goal is required" }, { status: 400 });

  const client = visionClient();
  const proposed = await proposeChain(client, goal);
  const steps = await Promise.all(
    proposed.map(async (p) => {
      const adapter = STEP_REGISTRY[p.toolId];
      const params = adapter ? await synthesizeParams(client, p.toolId, p.instructionText, adapter.paramsSchema) : {};
      return { toolId: p.toolId, instructionText: p.instructionText, params };
    }),
  );
  return NextResponse.json({ steps });
}
