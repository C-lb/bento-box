import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { createHeadshot } from "@event-editor/core/headshot";
import { getFrame } from "@event-editor/core/frames";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startHeadshot } from "@/lib/studio";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { toHeadshotDto } from "@/lib/headshot-dto";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const driveFileId = body?.driveFileId;
  const frameId = body?.frameId;
  if (!driveFileId || !frameId) {
    return NextResponse.json({ error: "driveFileId and frameId required" }, { status: 400 });
  }
  if (!getFrame(frameId)) return NextResponse.json({ error: "unknown frame" }, { status: 400 });

  const db = getDb();
  const drive = await authedDriveClient(db);
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const id = createHeadshot(db, {
    driveFileId,
    frameId,
    nameText: body?.nameText ?? "",
    titleText: body?.titleText ?? "",
  });
  startHeadshot(db, makeDriveClient(drive), id);
  return NextResponse.json({ id });
}

export async function GET() {
  const rows = getDb().select().from(headshots).orderBy(desc(headshots.id)).limit(24).all();
  return NextResponse.json({ headshots: rows.map(toHeadshotDto) });
}
