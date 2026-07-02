import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { googleAccessToken } from "@/lib/google/oauth";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  const appId = process.env.GOOGLE_PICKER_APP_ID;
  if (!apiKey || !appId) {
    return NextResponse.json(
      { error: "Drive picker is not configured. Set GOOGLE_PICKER_API_KEY and GOOGLE_PICKER_APP_ID." },
      { status: 400 },
    );
  }
  const tok = await googleAccessToken(getDb());
  if (!tok) {
    return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
  }
  return NextResponse.json({ access_token: tok.token, expires_at: tok.expiresAt, apiKey, appId });
}
