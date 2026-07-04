// Shared filename hygiene for the utility tools. Mirrors convert.ts's private
// safeBase but is exported for reuse.
export function safeBase(raw: string): string {
  return raw
    .replace(/[\/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 120);
}

// Replace (or append) a file extension. `ext` is given without a dot.
export function swapExt(name: string, ext: string): string {
  const withoutExt = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const base = safeBase(withoutExt) || "file";
  return `${base}.${ext}`;
}
