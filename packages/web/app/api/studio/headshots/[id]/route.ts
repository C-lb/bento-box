import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { toHeadshotDto } from "@/lib/headshot-dto";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getDb().select().from(headshots).where(eq(headshots.id, Number(id))).all()[0];
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ headshot: toHeadshotDto(r) });
}
