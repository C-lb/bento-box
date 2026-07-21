import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, authEnabled, AUTH_COOKIE } from "@/lib/auth";
import { capForPath, isPublicAsset, MB } from "@/lib/limits";

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/health"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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

  if (!authEnabled() || PUBLIC.has(pathname) || isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  const ok = await verifyToken(
    process.env.EE_AUTH_SECRET!,
    req.cookies.get(AUTH_COOKIE)?.value,
    Date.now(),
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Exclude true static prefixes, plus the large-upload API routes. Next.js
  // truncates any middleware-matched request body at ~10 MiB, which silently
  // corrupts uploads bigger than that. Those routes run their own cap + auth via
  // guardUpload() instead (see lib/upload-guard.ts — keep this list in sync with
  // UPLOAD_ROUTE_PREFIXES). Extension-based exemptions for everything else are
  // decided inside the middleware via isPublicAsset() so that /api/... paths
  // ending in an asset extension can never bypass auth or upload caps.
  matcher: [
    "/((?!_next/|mediapipe/|api/slice/convert|api/video|api/splice|api/transcribe|api/convert/file|api/heic|api/resize|api/pdf/process|api/studio/upload|api/workflow/upload).*)",
  ],
};
