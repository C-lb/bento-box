import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";
import { startScan } from "@/lib/sorter";
import { isPlatform, type Platform } from "@event-editor/core/ranking-context";
import { jobs } from "@event-editor/core/schema";

export async function GET() {
  const rows = getDb().select().from(jobs).orderBy(desc(jobs.createdAt)).all();
  return NextResponse.json({
    jobs: rows.map((r) => ({
      id: r.id,
      driveFolderName: r.driveFolderName,
      platform: r.platform,
      status: r.status,
      total: r.total,
      processed: r.processed,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const { folderId, folderName, platform } = await request.json();
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
  const plat: Platform = typeof platform === "string" && isPlatform(platform) ? platform : "linkedin";
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const jobId = startScan(getDb(), makeDriveClient(drive), { folderId, folderName: folderName ?? "(folder)", platform: plat });
  return NextResponse.json({ jobId });
}
