import { NextResponse } from "next/server";
import { makeOAuthClient, buildAuthUrl } from "@/lib/google/oauth";

export async function GET() {
  return NextResponse.redirect(buildAuthUrl(makeOAuthClient()));
}
