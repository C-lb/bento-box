import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { convertDir, sanitizeConvertId } from "@/lib/convert";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  zip: "application/zip",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

export async function POST(request: Request) {
  try {
    const { id, filename, folderId, ext: rawExt } = (await request.json()) as {
      id?: string; filename?: string; folderId?: string; ext?: string;
    };
    if (!id || !folderId) return NextResponse.json({ error: "id and folderId required" }, { status: 400 });
    const clean = sanitizeConvertId(id);
    const ext = rawExt && Object.hasOwn(CONTENT_TYPES, rawExt) ? rawExt : "mp3";
    const name = filename || `audio.${ext}`;

    const drive = await authedDriveClient(getDb());
    if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });

    const bytes = await readFile(resolve(convertDir(clean), `out.${ext}`));
    const res = await makeDriveClient(drive).uploadFile(name, new Uint8Array(bytes), CONTENT_TYPES[ext], folderId);
    return NextResponse.json({ url: res.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
