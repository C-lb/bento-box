export const MB = 1_000_000;
export const GB = 1_000_000_000;

const CLASSES: Array<{ prefixes: string[]; cap: number }> = [
  { prefixes: ["/api/video", "/api/splice"], cap: 2 * GB },
  { prefixes: ["/api/convert", "/api/transcribe"], cap: 500 * MB },
];

export function capForPath(pathname: string): number | null {
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) return null;
  for (const c of CLASSES) if (c.prefixes.some((p) => pathname.startsWith(p))) return c.cap;
  return 100 * MB;
}
