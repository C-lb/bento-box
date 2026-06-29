import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const folderId = new URL(request.url).searchParams.get("folderId");
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const images = await makeDriveClient(drive).listImages(folderId);
  return NextResponse.json({ images: images.map((i) => ({ id: i.id, name: i.name })) });
}
