import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { listHeicBatches } from "@event-editor/core/heic-history";
import { getDb } from "@/lib/db";
import { jobDir } from "@/lib/jobs";

export const runtime = "nodejs";

// Past HEIC conversions, grouped into batches. Each file is marked expired once
// its on-disk job (kept ~6h) has been swept, so the UI can hide dead downloads.
export async function GET() {
  const batches = listHeicBatches(getDb());
  return NextResponse.json({
    batches: batches.map((b) => ({
      batchId: b.batchId,
      createdAt: b.createdAt,
      items: b.items.map((it) => ({
        ...it,
        expired: !existsSync(jobDir("heic", it.jobId)),
      })),
    })),
  });
}
