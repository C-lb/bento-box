import { NextResponse } from "next/server";
import { makeToken, AUTH_COOKIE, AUTH_MAX_AGE_S } from "@/lib/auth";

export const runtime = "nodejs";

const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { n: number; resetAt: number }>();

/** Test hook: clear the in-memory rate limiter. */
export function _resetAttempts(): void {
  attempts.clear();
}

export async function POST(request: Request) {
  const passcode = process.env.EE_AUTH_PASSCODE;
  const secret = process.env.EE_AUTH_SECRET;
  if (!passcode || !secret) {
    return NextResponse.json({ error: "Auth is not configured on this server" }, { status: 500 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.resetAt > now && a.n >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (code !== passcode) {
    const cur = a && a.resetAt > now ? a : { n: 0, resetAt: now + WINDOW_MS };
    attempts.set(ip, { n: cur.n + 1, resetAt: cur.resetAt });
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
