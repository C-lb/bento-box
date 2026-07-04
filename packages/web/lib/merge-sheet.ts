import type { Rows } from "@event-editor/core/merge";

export function rowsFromValues(values: { header: string[]; rows: string[][] }): Rows {
  const headers = values.header.map((h) => String(h).trim());
  if (headers.length === 0) return { headers: [], rows: [] };
  const rows = values.rows
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = String(r[i] ?? "").trim(); });
      return row;
    });
  return { headers, rows };
}
