// Replace [start,end) in draft with replacement. Clamps out-of-range indices.
export function spliceSelection(draft: string, start: number, end: number, replacement: string): string {
  const a = Math.max(0, Math.min(start, draft.length));
  const b = Math.max(a, Math.min(end, draft.length));
  return draft.slice(0, a) + replacement + draft.slice(b);
}
