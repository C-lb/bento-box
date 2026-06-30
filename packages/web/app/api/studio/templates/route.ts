import { NextResponse } from "next/server";
import { getToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";
import { makeCanvaClient } from "@/lib/canva/client";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  if (!getToken(db, "canva")) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const templates = await makeCanvaClient(db).listBrandTemplates();
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
