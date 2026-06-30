import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthUrl, CANVA_REDIRECT } from "@/lib/canva/oauth";
import { createVerifier, challengeFor } from "@/lib/canva/pkce";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.CANVA_CLIENT_ID) {
    return NextResponse.redirect(new URL("/settings?canva=error", CANVA_REDIRECT));
  }
  const state = randomBytes(16).toString("hex");
  const verifier = createVerifier();
  const res = NextResponse.redirect(buildAuthUrl(state, challengeFor(verifier)));
  const opts = { httpOnly: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  res.cookies.set("canva_state", state, opts);
  res.cookies.set("canva_verifier", verifier, opts);
  return res;
}
