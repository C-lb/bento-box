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
