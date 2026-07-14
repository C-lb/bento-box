import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { desc } from "drizzle-orm";
import { createHeadshot, createCanvaHeadshot } from "@event-editor/core/headshot";
import { getFrame } from "@event-editor/core/frames";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startHeadshot, startHeadshotCanva } from "@/lib/studio";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { jobDir, sanitizeJobId } from "@/lib/jobs";
import { toHeadshotDto } from "@/lib/headshot-dto";

export const runtime = "nodejs";

// Accept only known style fields, clamp the zoom, and only allow a #rrggbb
// colour so nothing untrusted reaches the SVG we render.
function sanitizeStyle(raw: unknown): import("@event-editor/core/frames").HeadshotStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const color = typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : undefined;
  const zoom = typeof s.zoom === "number" && Number.isFinite(s.zoom) ? Math.min(3, Math.max(1, s.zoom)) : undefined;
  const style = {
    bold: !!s.bold,
    italic: !!s.italic,
    uppercase: !!s.uppercase,
    ...(color ? { color } : {}),
    ...(zoom != null ? { zoom } : {}),
  };
  // Nothing set? Don't persist an all-default object.
  if (!style.bold && !style.italic && !style.uppercase && !color && (zoom == null || zoom === 1)) return undefined;
  return style;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const renderer = body?.renderer === "canva" ? "canva" : "local";
  const driveFileId = body?.driveFileId;

  // A local upload takes precedence over a Drive file. sanitizeJobId strips any
  // path characters, so the id can only ever resolve inside the uploads dir.
  let uploadPath: string | undefined;
  if (body?.uploadId) {
    const p = resolve(jobDir("studio-upload", sanitizeJobId(String(body.uploadId))), "src");
    if (!existsSync(p)) {
      return NextResponse.json({ error: "Uploaded image not found. Please upload it again." }, { status: 400 });
    }
    uploadPath = p;
  }

  if (!uploadPath && !driveFileId) {
    return NextResponse.json({ error: "driveFileId or uploadId required" }, { status: 400 });
  }

  const db = getDb();
  // Drive is only needed to fetch a Drive-sourced photo; uploads never touch it.
  const drive = await authedDriveClient(db);
  if (!uploadPath && !drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const driveClient = drive ? makeDriveClient(drive) : null;

  if (renderer === "canva") {
    const templateId = body?.templateId;
    if (!templateId) return NextResponse.json({ error: "templateId required" }, { status: 400 });
    const id = createCanvaHeadshot(db, {
      driveFileId,
      uploadPath,
      canvaTemplateId: templateId,
      nameText: body?.nameText ?? "",
      titleText: body?.titleText ?? "",
    });
    startHeadshotCanva(db, driveClient, id);
    return NextResponse.json({ id });
  }

  const frameId = body?.frameId;
  if (!frameId || !getFrame(frameId)) return NextResponse.json({ error: "unknown frame" }, { status: 400 });
  const id = createHeadshot(db, {
    driveFileId,
    uploadPath,
    frameId,
    nameText: body?.nameText ?? "",
    titleText: body?.titleText ?? "",
    style: sanitizeStyle(body?.style),
  });
  startHeadshot(db, driveClient, id);
  return NextResponse.json({ id });
}

export async function GET() {
  const rows = getDb().select().from(headshots).orderBy(desc(headshots.id)).limit(24).all();
  return NextResponse.json({ headshots: rows.map(toHeadshotDto) });
}
