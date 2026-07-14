import { NextResponse } from "next/server";
import { checkSpotify } from "@/lib/spotify";

export const runtime = "nodejs";

// Reports whether the configured Spotify credentials still authenticate. There
// is no refresh token or expiry to track (Client Credentials mints hourly
// tokens on demand), so this is a live connectivity check, not a countdown.
export async function GET() {
  return NextResponse.json(await checkSpotify());
}
