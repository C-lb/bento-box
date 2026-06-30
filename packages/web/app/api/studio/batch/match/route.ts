import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authedSheetsClient, extractSpreadsheetId, readValues } from "@/lib/google/sheets";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { matchSheetRows } from "@/lib/batch";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { spreadsheetId, tab, mapping, folderId } = body ?? {};
  if (!spreadsheetId || !tab || !mapping || mapping.name == null || !folderId) {
    return NextResponse.json({ error: "spreadsheetId, tab, mapping.name, folderId required" }, { status: 400 });
  }
  const db = getDb();
  const sheets = await authedSheetsClient(db);
  const drive = await authedDriveClient(db);
  if (!sheets || !drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  try {
    const { header, rows } = await readValues(sheets, extractSpreadsheetId(spreadsheetId), tab);
    const folderFiles = (await makeDriveClient(drive).listImages(folderId)).map((i) => ({ id: i.id, name: i.name }));
    return NextResponse.json({ rows: matchSheetRows({ header, rows, mapping, folderFiles }) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 502 });
  }
}
