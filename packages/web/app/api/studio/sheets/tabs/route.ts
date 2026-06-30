import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authedSheetsClient, extractSpreadsheetId, listTabs } from "@/lib/google/sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("spreadsheetId");
  if (!raw) return NextResponse.json({ error: "spreadsheetId required" }, { status: 400 });
  const sheets = await authedSheetsClient(getDb());
  if (!sheets) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const tabs = await listTabs(sheets, extractSpreadsheetId(raw));
    return NextResponse.json({ tabs });
  } catch (e: any) {
    const status = e?.code === 403 || e?.response?.status === 403 ? 403 : 502;
    return NextResponse.json({ error: status === 403 ? "scope_or_access" : String(e?.message ?? e) }, { status });
  }
}
