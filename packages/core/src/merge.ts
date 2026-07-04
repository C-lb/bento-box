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

export function deriveFields(spec: DocumentSpec): string[] {
  const seen: string[] = [];
  for (const el of spec.elements) {
    if (el.kind !== "text") continue;
    for (const m of el.template.matchAll(/\{([^}]+)\}/g)) {
      const f = m[1].trim();
      if (!seen.includes(f)) seen.push(f);
    }
  }
  return seen;
}

const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ["name", "full name", "recipient", "attendee"],
  org: ["org", "organisation", "organization", "company", "employer"],
  role: ["role", "title", "position", "job title"],
  date: ["date", "day"],
  email: ["email", "e-mail", "mail"],
};

export function autoMatchColumns(
  fields: string[],
  headers: string[],
): Record<string, string | null> {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Set<string>();
  const out: Record<string, string | null> = {};
  for (const field of fields) {
    const fn = norm(field);
    // 1) exact case-insensitive header
    let hit = headers.find((h) => !taken.has(h) && norm(h) === fn);
    // 2) synonym table (field's synonyms, or the field name itself)
    if (!hit) {
      const syns = FIELD_SYNONYMS[fn] ?? [fn];
      hit = headers.find((h) => !taken.has(h) && syns.includes(norm(h)));
    }
    out[field] = hit ?? null;
    if (hit) taken.add(hit);
  }
  return out;
}
