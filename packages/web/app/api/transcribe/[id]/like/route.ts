import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import { toggleLiked } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const format = body.format;
  if (format !== "linkedin" && format !== "article") return NextResponse.json({ error: "bad format" }, { status: 400 });
  const db = getDb();
  const row = db.select().from(transcriptions).where(eq(transcriptions.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const draft = format === "linkedin" ? row.summaryLinkedin : row.summaryArticle;
  if (!draft || !draft.trim()) return NextResponse.json({ error: "no draft to like" }, { status: 409 });
  const { liked } = toggleLiked(db, format, draft);
  return NextResponse.json({ liked });
}
