import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { mp3Path, sanitizeConvertId } from "@/lib/convert";
import { sanitizeMp3Filename } from "@event-editor/core/convert";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { id, filename, folderId } = (await request.json()) as { id?: string; filename?: string; folderId?: string };
    if (!id || !folderId) return NextResponse.json({ error: "id and folderId required" }, { status: 400 });
    const clean = sanitizeConvertId(id);
    const name = sanitizeMp3Filename(filename || "audio");

    const drive = await authedDriveClient(getDb());
    if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });

    const bytes = await readFile(mp3Path(clean));
    const res = await makeDriveClient(drive).uploadFile(name, new Uint8Array(bytes), "audio/mpeg", folderId);
    return NextResponse.json({ url: res.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
