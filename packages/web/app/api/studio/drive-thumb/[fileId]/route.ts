import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const bytes = await makeDriveClient(drive).thumbnailFor(fileId);
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}
