import { NextResponse } from "next/server";
import { makeOAuthClient, exchangeCode } from "@/lib/google/oauth";
import { saveToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/settings?google=error", request.url));
  }
  try {
    const token = await exchangeCode(makeOAuthClient(), code);
    saveToken(getDb(), "google", token);
    return NextResponse.redirect(new URL("/settings?google=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?google=error", request.url));
  }
}
