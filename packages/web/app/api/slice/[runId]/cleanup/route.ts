import { NextResponse } from "next/server";
import { cleanupRun } from "@/lib/slice";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  try {
    await cleanupRun(runId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
