import { NextResponse } from "next/server";
import { dependencyStatuses } from "@/lib/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const deps = await dependencyStatuses();
  return NextResponse.json({
    ok: true,
    deps: deps.map((d) => ({ id: d.id, ready: d.ready, version: d.version })),
  });
}
