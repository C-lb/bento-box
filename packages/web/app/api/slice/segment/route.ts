import { NextResponse } from "next/server";
import { visionClient, segmentSpeakers } from "@/lib/anthropic";
import type { SlideText } from "@event-editor/core/pptx";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 400 });
  }
  try {
    const { slides } = (await request.json()) as { slides: SlideText[] };
    if (!Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json({ error: "slides required" }, { status: 400 });
    }
    const groups = await segmentSpeakers(visionClient(), slides);
    return NextResponse.json({ groups });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
