import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/canva/oauth";
import { saveToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = request.headers.get("cookie") ?? "";
  const cookieState = /canva_state=([^;]+)/.exec(jar)?.[1];
  const verifier = /canva_verifier=([^;]+)/.exec(jar)?.[1];

  if (!code || !state || !verifier || state !== cookieState) {
    return NextResponse.redirect(new URL("/settings?canva=error", request.url));
  }
  try {
    const token = await exchangeCode(code, verifier);
    saveToken(getDb(), "canva", token);
    const res = NextResponse.redirect(new URL("/settings?canva=connected", request.url));
    res.cookies.delete("canva_state");
    res.cookies.delete("canva_verifier");
    return res;
  } catch {
    return NextResponse.redirect(new URL("/settings?canva=error", request.url));
  }
}
