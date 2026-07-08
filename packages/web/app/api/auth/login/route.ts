import { NextResponse } from "next/server";
import { makeToken, AUTH_COOKIE, AUTH_MAX_AGE_S } from "@/lib/auth";

export const runtime = "nodejs";

const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;
const GLOBAL_MAX_FAILURES = 100;
const attempts = new Map<string, { n: number; resetAt: number }>();
let globalFailures = { n: 0, resetAt: 0 };

/** Test hook: clear the in-memory rate limiter. */
export function _resetAttempts(): void {
  attempts.clear();
  globalFailures = { n: 0, resetAt: 0 };
}

/**
 * Client-forgeable through the tunnel: Cloudflare appends the real client IP
 * to any client-supplied X-Forwarded-For rather than stripping it, so an
 * attacker can send a fresh X-Forwarded-For per request and get a fresh
 * bucket every time. cf-connecting-ip is set authoritatively by Cloudflare
 * and cannot be spoofed by the client through the tunnel — prefer it.
 * Falls back to first-hop XFF (non-CF deployments), then "local".
 */
function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || "local";
}

export async function POST(request: Request) {
  const passcode = process.env.EE_AUTH_PASSCODE;
  const secret = process.env.EE_AUTH_SECRET;
  if (!passcode || !secret) {
    return NextResponse.json({ error: "Auth is not configured on this server" }, { status: 500 });
  }
  const ip = clientIp(request);
  const now = Date.now();
  if (globalFailures.resetAt > now && globalFailures.n >= GLOBAL_MAX_FAILURES) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const a = attempts.get(ip);
  if (a && a.resetAt > now && a.n >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (code !== passcode) {
    const cur = a && a.resetAt > now ? a : { n: 0, resetAt: now + WINDOW_MS };
    attempts.set(ip, { n: cur.n + 1, resetAt: cur.resetAt });
    const gCur = globalFailures.resetAt > now ? globalFailures : { n: 0, resetAt: now + WINDOW_MS };
    globalFailures = { n: gCur.n + 1, resetAt: gCur.resetAt };
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }
  attempts.delete(ip);
  const token = await makeToken(secret, now + AUTH_MAX_AGE_S * 1000);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: AUTH_MAX_AGE_S,
  });
  return res;
}
