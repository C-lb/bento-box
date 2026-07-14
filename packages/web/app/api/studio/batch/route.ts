import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { createBatchHeadshots } from "@event-editor/core/headshot";
import { getFrame } from "@event-editor/core/frames";
import { runBatch } from "@/lib/batch";
import { sanitizeStyle } from "@/lib/headshot-style-sanitize";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const renderer = body?.renderer === "canva" ? "canva" : "local";
  const styleId = body?.styleId;
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!styleId || !rows || rows.length === 0) {
    return NextResponse.json({ error: "styleId and a non-empty rows[] required" }, { status: 400 });
  }
  if (renderer === "local" && !getFrame(styleId)) {
    return NextResponse.json({ error: "unknown frame" }, { status: 400 });
  }
  const clean = rows
    .filter((r: any) => r?.driveFileId)
    .map((r: any) => ({ driveFileId: String(r.driveFileId), nameText: String(r.nameText ?? ""), titleText: String(r.titleText ?? "") }));
  if (clean.length === 0) return NextResponse.json({ error: "no rows with a resolved photo" }, { status: 400 });

  const db = getDb();
  const drive = await authedDriveClient(db);
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  // A preset's look applies to every local-rendered row; Canva ignores it.
  const style = renderer === "local" ? sanitizeStyle(body?.style) : undefined;

  const batchId = randomBytes(8).toString("hex");
  const ids = createBatchHeadshots(db, { batchId, renderer, styleId, rows: clean, style });
  runBatch(db, makeDriveClient(drive), renderer, ids);
  return NextResponse.json({ batchId, ids });
}
