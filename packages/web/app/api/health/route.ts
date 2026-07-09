import { NextResponse } from "next/server";
import { dependencyStatuses } from "@/lib/deps";
import { getConnections } from "@event-editor/core/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const deps = await dependencyStatuses();
  const keys = getConnections().map((c) => ({ id: c.id, configured: c.configured }));
  return NextResponse.json({
    ok: true,
    deps: deps.map((d) => ({ id: d.id, ready: d.ready, version: d.version })),
    keys,
  });
}
