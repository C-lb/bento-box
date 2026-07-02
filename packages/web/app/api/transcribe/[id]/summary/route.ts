import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import type { EventDetails } from "@event-editor/core/transcribe";
import { promptExamples } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";
import { visionClient, generateFormattedSummary, regenerateSelection } from "@/lib/anthropic";
import { pickCachedSummary, type SummaryFormat } from "@/lib/summary-format";
import { spliceSelection } from "@/lib/summary-splice";

export const runtime = "nodejs";

const EMPTY: EventDetails = { eventName: "", eventDescription: "", speakers: [], sponsors: [] };

function saveDraft(db: ReturnType<typeof getDb>, id: number, format: SummaryFormat, text: string) {
  const col = format === "linkedin" ? { summaryLinkedin: text } : { summaryArticle: text };
  db.update(transcriptions).set({ ...col, updatedAt: Date.now() }).where(eq(transcriptions.id, id)).run();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  const body = await req.json().catch(() => ({}));
  const format = body.format as SummaryFormat;
  if (format !== "linkedin" && format !== "article") return NextResponse.json({ error: "bad format" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 400 });

  const db = getDb();
  const row = db.select().from(transcriptions).where(eq(transcriptions.id, nid)).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const details: EventDetails = row.eventDetails ? JSON.parse(row.eventDetails) : EMPTY;
  const examples = promptExamples(db, format);

  try {
    // Save a hand-edited draft.
    if (body.save === true && typeof body.draft === "string") {
      saveDraft(db, nid, format, body.draft);
      return NextResponse.json({ text: body.draft });
    }

    // Regenerate a selected span within the provided draft.
    if (typeof body.draft === "string" && Number.isInteger(body.selStart) && Number.isInteger(body.selEnd)) {
      const draft: string = body.draft;
      const selection = draft.slice(body.selStart, body.selEnd);
      if (!selection.trim()) return NextResponse.json({ error: "empty selection" }, { status: 400 });
      const rewritten = await regenerateSelection(visionClient(), format, draft, selection, details, examples);
      const next = spliceSelection(draft, body.selStart, body.selEnd, rewritten);
      saveDraft(db, nid, format, next);
      return NextResponse.json({ text: next });
    }

    // Whole-draft regenerate (bypass cache) or first-time generate.
    if (!row.transcriptText) return NextResponse.json({ error: "transcript not ready" }, { status: 409 });
    if (!body.regenerate) {
      const cached = pickCachedSummary(row as any, format);
      if (cached) return NextResponse.json({ text: cached });
    }
    const text = await generateFormattedSummary(visionClient(), format, row.transcriptText, details, examples);
    saveDraft(db, nid, format, text);
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "generation failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.update(transcriptions)
    .set({ summaryLinkedin: null, summaryArticle: null, updatedAt: Date.now() })
    .where(eq(transcriptions.id, Number(id)))
    .run();
  return NextResponse.json({ ok: true });
}
