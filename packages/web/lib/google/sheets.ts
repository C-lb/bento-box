import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { getToken, saveToken } from "@event-editor/core/tokens";
import { makeOAuthClient } from "./oauth";
import type { openDb } from "@event-editor/core/db";

const URL_ID = /\/spreadsheets\/d\/([-\w]+)/;

export function extractSpreadsheetId(input: string): string {
  const m = URL_ID.exec(input.trim());
  return m ? m[1] : input.trim();
}

export async function authedSheetsClient(db: ReturnType<typeof openDb>): Promise<sheets_v4.Sheets | null> {
  const stored = getToken(db, "google");
  if (!stored) return null;
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiryMs ?? undefined,
  });
  client.on("tokens", (t) => {
    saveToken(db, "google", {
      accessToken: t.access_token ?? stored.accessToken,
      refreshToken: t.refresh_token ?? null,
      expiryMs: t.expiry_date ?? null,
      scope: t.scope ?? null,
    });
  });
  return google.sheets({ version: "v4", auth: client });
}

export async function listTabs(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<string[]> {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  return (res.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
}

export async function readValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
): Promise<{ header: string[]; rows: string[][] }> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tab });
  const values = (res.data.values ?? []) as string[][];
  if (values.length === 0) return { header: [], rows: [] };
  return { header: values[0].map((c) => String(c ?? "")), rows: values.slice(1).map((r) => r.map((c) => String(c ?? ""))) };
}
