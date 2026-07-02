import { NextResponse } from "next/server";
import { listExamples, addExample, type Format } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function parseFormat(v: string | null): Format | null {
  return v === "linkedin" || v === "article" ? v : null;
}

export async function GET(req: Request) {
  const format = parseFormat(new URL(req.url).searchParams.get("format"));
  if (!format) return NextResponse.json({ error: "bad format" }, { status: 400 });
  return NextResponse.json(listExamples(getDb(), format));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const format = parseFormat(body.format);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!format) return NextResponse.json({ error: "bad format" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  const item = addExample(getDb(), format, "custom", text);
  return NextResponse.json(item);
}
