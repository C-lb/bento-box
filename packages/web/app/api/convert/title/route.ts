import { NextResponse } from "next/server";
import { hasYtDlp, fetchTitle } from "@/lib/convert";
import { defaultNameFromSource } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasYtDlp()) {
    return NextResponse.json({ error: "yt-dlp is not installed" }, { status: 400 });
  }
  const { url } = (await request.json()) as { url?: string };
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
  }
  try {
    const raw = await fetchTitle(url);
    return NextResponse.json({ title: defaultNameFromSource(raw || "audio") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
