import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// App version for the nav tooltip. The desktop shell sets EE_APP_VERSION from
// Electron's app.getVersion(); a plain `next dev`/`next start` has no version.
export async function GET() {
  return NextResponse.json({ version: process.env.EE_APP_VERSION ?? null });
}
