import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { listSliceRuns } from "@event-editor/core/slice-runs";
import { getDb } from "@/lib/db";
import { runDir } from "@/lib/slice";

export const runtime = "nodejs";

export async function GET() {
  const rows = listSliceRuns(getDb());
  return NextResponse.json({
    runs: rows.map((r) => ({
      runId: r.runId,
      sourceFilename: r.sourceFilename,
      status: r.status,
      createdAt: r.createdAt,
      expired: !existsSync(runDir(r.runId)),
    })),
  });
}
