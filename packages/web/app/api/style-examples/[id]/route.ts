import { NextResponse } from "next/server";
import { updateExample, deleteExample } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  updateExample(getDb(), Number(id), text);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteExample(getDb(), Number(id));
  return NextResponse.json({ ok: true });
}
