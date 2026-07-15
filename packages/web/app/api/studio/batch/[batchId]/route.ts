import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { toHeadshotDto } from "@/lib/headshot-dto";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const rows = getDb().select().from(headshots).where(eq(headshots.batchId, batchId)).all();
  return NextResponse.json({ batchId, headshots: rows.map(toHeadshotDto) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const db = getDb();
  const rows = db.select().from(headshots).where(eq(headshots.batchId, batchId)).all();
  // Mirror the single-headshot DELETE: remove each rendered file so batch delete
  // never orphans outputs the per-row delete would have cleaned up.
  for (const r of rows) {
    if (r.outputPath) await rm(r.outputPath, { force: true }).catch(() => {});
  }
  db.delete(headshots).where(eq(headshots.batchId, batchId)).run();
  return NextResponse.json({ ok: true });
}
