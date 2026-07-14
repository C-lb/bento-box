import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { googleAccessToken } from "@/lib/google/oauth";

export const runtime = "nodejs";

export async function GET() {
  // The Picker works with just the signed-in OAuth token. A developer key and
  // app ID are optional refinements (the key raises quota, the app ID scopes to
  // your Cloud project), so pass them through only when they're configured
  // rather than blocking the picker when they're absent.
  const apiKey = process.env.GOOGLE_PICKER_API_KEY || null;
  const appId = process.env.GOOGLE_PICKER_APP_ID || null;
  const tok = await googleAccessToken(getDb());
  if (!tok) {
    return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
  }
  return NextResponse.json({ access_token: tok.token, expires_at: tok.expiresAt, apiKey, appId });
}
