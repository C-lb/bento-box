import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";
import { startScan } from "@/lib/sorter";

export async function POST(request: Request) {
  const { folderId, folderName } = await request.json();
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const jobId = startScan(getDb(), makeDriveClient(drive), { folderId, folderName: folderName ?? "(folder)" });
  return NextResponse.json({ jobId });
}
