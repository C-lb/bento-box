import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import type { EventDetails } from "@event-editor/core/transcribe";
import { getDb } from "@/lib/db";
import { visionClient, generateFormattedSummary } from "@/lib/anthropic";
import { pickCachedSummary, type SummaryFormat } from "@/lib/summary-format";

export const runtime = "nodejs";

const EMPTY: EventDetails = { eventName: "", eventDescription: "", speakers: [], sponsors: [] };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const format = body.format as SummaryFormat;
  if (format !== "linkedin" && format !== "article") return NextResponse.json({ error: "bad format" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 400 });

  const db = getDb();
  const row = db.select().from(transcriptions).where(eq(transcriptions.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!row.transcriptText) return NextResponse.json({ error: "transcript not ready" }, { status: 409 });

  const cached = pickCachedSummary(row as any, format);
  if (cached) return NextResponse.json({ text: cached });

  const details: EventDetails = row.eventDetails ? JSON.parse(row.eventDetails) : EMPTY;
  try {
    const text = await generateFormattedSummary(visionClient(), format, row.transcriptText, details);
    const col = format === "linkedin" ? { summaryLinkedin: text } : { summaryArticle: text };
    db.update(transcriptions).set({ ...col, updatedAt: Date.now() }).where(eq(transcriptions.id, Number(id))).run();
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "generation failed" }, { status: 500 });
  }
}
