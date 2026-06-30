import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authedSheetsClient, extractSpreadsheetId, readValues } from "@/lib/google/sheets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("spreadsheetId");
  const tab = params.get("tab");
  if (!raw || !tab) return NextResponse.json({ error: "spreadsheetId and tab required" }, { status: 400 });
  const sheets = await authedSheetsClient(getDb());
  if (!sheets) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const data = await readValues(sheets, extractSpreadsheetId(raw), tab);
    return NextResponse.json(data);
  } catch (e: any) {
    const status = e?.code === 403 || e?.response?.status === 403 ? 403 : 502;
    return NextResponse.json({ error: status === 403 ? "scope_or_access" : String(e?.message ?? e) }, { status });
  }
}
