export interface GroupInput { label: string; ranges: string }
export interface PlannedGroup { label: string; filename: string; pages: number[] }
export interface SlicePlan { groups: PlannedGroup[]; warnings: string[] }

/** Parse "1-3, 5" into a sorted, deduped list of 1-based page numbers. */
export function parseRanges(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(t)) {
      out.add(parseInt(t, 10));
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** Turn a human label into a filesystem-safe base name (no extension). */
export function safeFileName(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "part";
}

/** Collapse [1,2,3,5] into "1-3, 5" for readable warnings. */
export function summarizeRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(", ");
}

/** Build the ordered export plan from user group inputs and the master page count. */
export function planSlices(inputs: GroupInput[], pageCount: number): SlicePlan {
  const warnings: string[] = [];
  const groups: PlannedGroup[] = [];
  const usedNames = new Set<string>();
  const seenPages = new Map<number, string>();
  const covered = new Set<number>();

  inputs.forEach((g, i) => {
    const label = g.label.trim() || `Part ${i + 1}`;
    const raw = parseRanges(g.ranges);
    const pages = raw.filter((p) => p >= 1 && p <= pageCount);
    if (raw.some((p) => p < 1 || p > pageCount)) {
      warnings.push(`"${label}": some pages fall outside 1-${pageCount} and were dropped.`);
    }
    if (pages.length === 0) {
      warnings.push(`"${label}" has no valid pages and was skipped.`);
      return;
    }
    for (const p of pages) {
      if (seenPages.has(p)) warnings.push(`Page ${p} is in both "${seenPages.get(p)}" and "${label}".`);
      else seenPages.set(p, label);
      covered.add(p);
    }
    let base = safeFileName(label);
    let name = base;
    let n = 2;
    while (usedNames.has(name)) name = `${base}-${n++}`;
    usedNames.add(name);
    groups.push({ label, filename: `${name}.pdf`, pages });
  });

  const missing: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (!covered.has(p)) missing.push(p);
  if (missing.length) warnings.push(`Pages not in any group: ${summarizeRanges(missing)}.`);

  return { groups, warnings };
}
