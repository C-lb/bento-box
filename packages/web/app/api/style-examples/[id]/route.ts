import { NextResponse } from "next/server";
import { updateExample, deleteExample } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  updateExample(getDb(), nid, text);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  deleteExample(getDb(), nid);
  return NextResponse.json({ ok: true });
}
