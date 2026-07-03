import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getRankingContext,
  setRankingContext,
  resetRankingContext,
  isEditablePlatform,
  DEFAULT_CONTEXTS,
} from "@event-editor/core/ranking-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  return NextResponse.json({
    instagram: getRankingContext(db, "instagram"),
    linkedin: getRankingContext(db, "linkedin"),
    defaults: { instagram: DEFAULT_CONTEXTS.instagram, linkedin: DEFAULT_CONTEXTS.linkedin },
  });
}

export async function PUT(request: Request) {
  const { platform, text } = await request.json();
  if (typeof platform !== "string" || !isEditablePlatform(platform)) {
    return NextResponse.json({ error: "invalid platform" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  setRankingContext(getDb(), platform, text.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const platform = new URL(request.url).searchParams.get("platform") ?? "";
  if (!isEditablePlatform(platform)) {
    return NextResponse.json({ error: "invalid platform" }, { status: 400 });
  }
  resetRankingContext(getDb(), platform);
  return NextResponse.json({ text: getRankingContext(getDb(), platform) });
}
