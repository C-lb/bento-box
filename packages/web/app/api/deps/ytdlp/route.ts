import { NextResponse } from "next/server";
import { downloadYtDlp } from "@/lib/deps";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { version } = await downloadYtDlp();
    return NextResponse.json({ version });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
