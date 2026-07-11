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
  /** Stable id set by the layout factory (e.g. "title", "recipient", "signature") so design overrides can target it. */
  slot?: string;
  /** Overrides the heading/body role with a specific curated or uploaded font. */
  fontId?: string;
  /** Tracking, in pt between glyphs. */
  letterSpacing?: number;
  /** Text outline. */
  stroke?: { color: string; width: number };
}
export interface ImageElement {
  kind: "image";
  src: string;
  x: number; y: number; width: number; height: number;
}
export interface QrElement {
  kind: "qr";
  value: string;
  x: number; y: number;
  size: number;
}
export interface RectElement {
  kind: "rect";
  x: number; y: number; width: number; height: number;
  strokeColor: string;
  strokeWidth: number;
}
export interface LineElement {
  kind: "line";
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  thickness: number;
}
export type Element = TextElement | ImageElement | QrElement | RectElement | LineElement;

export interface DocumentSpec {
  page: PageSize;
  /** Full-page background drawn before elements. PNG/JPG src is a data URL;
   * PDF src is plain base64 of a single-page document. */
  background?: { kind: "png" | "jpg" | "pdf"; src: string };
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

  // No delimiter: single column, every line is a name (no header row).
  if (delim === null) {
    return { headers: ["Name"], rows: lines.map((l) => ({ Name: l })) };
  }

  // Delimited: first line is the header.
  const split = (l: string) => l.split(delim).map((c) => c.trim());
  const headers = split(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = split(l);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

export function deriveFields(spec: DocumentSpec): string[] {
  const seen: string[] = [];
  const scan = (tpl: string) => {
    for (const m of tpl.matchAll(/\{([^}]+)\}/g)) {
      const f = m[1].trim();
      if (!seen.includes(f)) seen.push(f);
    }
  };
  for (const el of spec.elements) {
    if (el.kind === "text") scan(el.template);
    else if (el.kind === "qr") scan(el.value);
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

/**
 * Remap every derived field's token against its matched sheet column, PLUS
 * explicitly remap the recipient's fixed token to the user's chosen recipient
 * column. This second step matters for Custom mode: a placed recipient field
 * element always carries the tool's fixed token (e.g. "Name"), and that token
 * is only sometimes also a `field` that `autoMatchColumns` resolves via
 * header/synonym matching — the user's typed recipient-column choice
 * (`recipientColumn`, already resolved through `mapping`) must win for that
 * key regardless of what auto-matching found (or didn't find) for it.
 */
export function remapRows(
  rows: Record<string, string>[],
  fields: string[],
  mapping: Record<string, string | null>,
  recipientDefault: string,
  recipientColumn: string,
): Record<string, string>[] {
  return rows.map((r) => {
    const out = { ...r };
    for (const fld of fields) {
      if (fld === recipientDefault) continue; // set explicitly below, from the user's recipient-column choice
      const col = mapping[fld] ?? fld;
      out[fld] = r[col] ?? r[fld] ?? "";
    }
    out[recipientDefault] = r[recipientColumn] ?? r[recipientDefault] ?? "";
    return out;
  });
}
