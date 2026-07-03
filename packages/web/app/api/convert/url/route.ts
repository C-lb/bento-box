import { NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import { hasYtDlp, newConvertId, convertDir, extractFromUrl, cleanupConvert, sweepOldConverts } from "@/lib/convert";
import { sanitizeMp3Filename } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasYtDlp()) {
    return NextResponse.json({ error: "yt-dlp is not installed. See the tool page for install steps." }, { status: 400 });
  }
  const { url, filename } = (await request.json()) as { url?: string; filename?: string };
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
  }
  const name = sanitizeMp3Filename(filename && filename.trim() ? filename : "audio");

  const id = newConvertId();
  await mkdir(convertDir(id), { recursive: true });
  try { await sweepOldConverts(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    await extractFromUrl(url, id);
    return NextResponse.json({ id, filename: name });
  } catch (err) {
    try { await cleanupConvert(id); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
