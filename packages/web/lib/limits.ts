export const MB = 1_000_000;
export const GB = 1_000_000_000;

const CLASSES: Array<{ prefixes: string[]; cap: number }> = [
  { prefixes: ["/api/video", "/api/splice", "/api/workflow/upload"], cap: 2 * GB },
  { prefixes: ["/api/convert", "/api/transcribe"], cap: 500 * MB },
];

/**
 * Public static files (served from public/) that the middleware lets through
 * without auth. Scoped: nothing under /api/ is ever a public asset, so an
 * extension suffix alone cannot bypass the gate (e.g. /api/slice/r/file/x.png).
 */
export function isPublicAsset(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  return /\.(svg|png|ico|js|wasm|tflite|css|map|txt|xml|webmanifest)$/.test(pathname);
}

export function capForPath(pathname: string): number | null {
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) return null;
  for (const c of CLASSES) if (c.prefixes.some((p) => pathname.startsWith(p))) return c.cap;
  return 100 * MB;
}
