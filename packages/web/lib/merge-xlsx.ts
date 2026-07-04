import * as XLSX from "xlsx";
import type { Rows } from "@event-editor/core/merge";

export function parseWorkbook(buf: ArrayBuffer): Rows {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  // header:1 -> array of arrays; defval "" keeps empty cells.
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => String(h).trim());
  const rows = grid.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = String(r[i] ?? "").trim(); });
      return row;
    });
  return { headers, rows };
}
