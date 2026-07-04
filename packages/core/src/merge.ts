export type Rows = { headers: string[]; rows: Record<string, string>[] };
export type Align = "left" | "center" | "right";
export interface PageSize { width: number; height: number }

export interface TextElement {
  kind: "text";
  template: string;
  x: number; y: number; size: number;
  font: "heading" | "body";
  align: Align;
  color: string;
}
export interface ImageElement {
  kind: "image";
  src: string;
  x: number; y: number; width: number; height: number;
}
export type Element = TextElement | ImageElement;

export interface DocumentSpec {
  page: PageSize;
  background?: string;
  elements: Element[];
}

/** Replace `{Header}` tokens with the row's value (case-insensitive key match). */
export function resolveText(template: string, row: Record<string, string>): string {
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = lower.get(key.trim().toLowerCase());
    return v == null ? "" : String(v);
  });
}

export function parseDelimited(text: string): Rows {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;

  // Single value, no delimiter, one line -> one Name row, no header line.
  if (delim === null && lines.length === 1) {
    return { headers: ["Name"], rows: [{ Name: lines[0] }] };
  }

  const split = (l: string) => (delim ? l.split(delim).map((c) => c.trim()) : [l]);
  const headers = delim ? split(lines[0]) : ["Name"];
  const bodyStart = delim ? 1 : 1; // first line is always header for multi-line input
  const dataLines = delim ? lines.slice(1) : lines.slice(1);

  const rows = dataLines.map((l) => {
    const cells = split(l);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}
