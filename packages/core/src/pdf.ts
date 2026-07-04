import { safeBase } from "./names.js";

// Parse a human page-range spec ("1-3, 5, 8-10") into per-output lists of
// 0-based page indices. Pages are 1-based in the spec, inclusive.
export function parsePageRanges(spec: string, pageCount: number): number[][] {
  const parts = spec.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error("Enter at least one page or range, like 1-3, 5");
  const out: number[][] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Could not read "${part}". Use page numbers like 1-3, 5`);
    const start = Number(m[1]);
    const end = m[2] != null ? Number(m[2]) : start;
    if (start < 1 || end < 1) throw new Error(`Pages start at 1 (saw "${part}")`);
    if (end < start) throw new Error(`Invalid range "${part}": the end is before the start`);
    if (end > pageCount) throw new Error(`"${part}" is out of range: the file has only ${pageCount} pages`);
    const list: number[] = [];
    for (let p = start; p <= end; p++) list.push(p - 1);
    out.push(list);
  }
  return out;
}

export function pdfOutName(base: string, suffix: string): string {
  const b = safeBase(base.replace(/\.pdf$/i, "")) || "document";
  return `${b}${suffix}`;
}
