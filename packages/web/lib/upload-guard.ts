import { NextResponse } from "next/server";
import { capForPath, MB } from "@/lib/limits";
import { verifyToken, authEnabled, AUTH_COOKIE } from "@/lib/auth";

/**
 * Route path prefixes that receive large file uploads. These are EXCLUDED from
 * the middleware matcher: Next.js truncates any middleware-matched request body
 * at ~10 MiB, which silently corrupts uploads larger than that (a 47 MB deck
 * arrives as a 10 MB fragment -> "source file could not be loaded"). Because
 * they skip middleware, each of these routes must call guardUpload() to run the
 * content-length cap + auth check the middleware would otherwise have applied.
 *
 * Keep this list in sync with the negative-lookahead in middleware.ts.
 */
export const UPLOAD_ROUTE_PREFIXES = [
  "/api/slice/convert",
  "/api/video",
  "/api/splice",
  "/api/transcribe",
  "/api/convert/file",
  "/api/heic",
  "/api/resize",
  "/api/pdf/process",
  "/api/studio/upload",
  "/api/workflow/upload",
] as const;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * The cap + auth checks the middleware performs, replicated for upload routes
 * that must bypass the middleware to avoid body truncation. Returns a Response
 * to send back when the request should be blocked, or null to let it proceed.
 */
export async function guardUpload(req: Request, nowMs: number = Date.now()): Promise<Response | null> {
  const pathname = new URL(req.url).pathname;

  const cap = capForPath(pathname);
  if (cap !== null && (req.method === "POST" || req.method === "PUT")) {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > cap) {
      return NextResponse.json(
        { error: `File too large. The limit here is ${Math.round(cap / MB)} MB.` },
        { status: 413 },
      );
    }
  }

  if (authEnabled()) {
    const ok = await verifyToken(process.env.EE_AUTH_SECRET!, readCookie(req, AUTH_COOKIE), nowMs);
    if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
