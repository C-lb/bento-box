import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import type { EventDetails } from "@event-editor/core/transcribe";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function clean(d: any): EventDetails {
  const rows = (v: any) => Array.isArray(v) ? v.map((s: any) => ({ name: String(s?.name ?? ""), company: String(s?.company ?? "") })) : [];
  return {
    eventName: String(d?.eventName ?? ""),
    eventDescription: String(d?.eventDescription ?? ""),
    speakers: rows(d?.speakers),
    sponsors: rows(d?.sponsors),
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const details = clean(await req.json().catch(() => ({})));
  // Editing details invalidates the cached formatted summaries.
  getDb().update(transcriptions)
    .set({ eventDetails: JSON.stringify(details), summaryLinkedin: null, summaryArticle: null, updatedAt: Date.now() })
    .where(eq(transcriptions.id, Number(id)))
    .run();
  return NextResponse.json({ ok: true });
}
