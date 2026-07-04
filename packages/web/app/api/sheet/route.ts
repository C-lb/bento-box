import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authedSheetsClient, extractSpreadsheetId, listTabs, readValues } from "@/lib/google/sheets";
import { rowsFromValues } from "@/lib/merge-sheet";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { url?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const url = (body.url ?? "").trim();
  if (!url || !/\/spreadsheets\/d\/|^[-\w]{20,}$/.test(url)) {
    return NextResponse.json({ error: "That does not look like a Google Sheet link." }, { status: 400 });
  }

  const sheets = await authedSheetsClient(getDb());
  if (!sheets) {
    return NextResponse.json(
      { error: "Google is not connected. Connect Google in a Drive-based tool first." },
      { status: 401 },
    );
  }

  try {
    const id = extractSpreadsheetId(url);
    const tabs = await listTabs(sheets, id);
    if (tabs.length === 0) return NextResponse.json({ headers: [], rows: [] });
    const values = await readValues(sheets, id, tabs[0]);
    return NextResponse.json(rowsFromValues(values));
  } catch (e: any) {
    const status = e?.code === 403 || e?.response?.status === 403 ? 403 : 502;
    const error = status === 403
      ? "That sheet is not shared with this app, or the connection lacks access."
      : "Could not read that sheet. Check the link and try again.";
    return NextResponse.json({ error }, { status });
  }
}
