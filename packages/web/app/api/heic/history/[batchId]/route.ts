import { NextResponse } from "next/server";
import { deleteHeicBatch } from "@event-editor/core/heic-history";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  deleteHeicBatch(getDb(), batchId);
  return NextResponse.json({ ok: true });
}
