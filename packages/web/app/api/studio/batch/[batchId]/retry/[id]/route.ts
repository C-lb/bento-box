import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { startHeadshot, startHeadshotCanva } from "@/lib/studio";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ batchId: string; id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.select().from(headshots).where(eq(headshots.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const drive = await authedDriveClient(db);
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  // reset to the renderer's initial status so the engine re-runs cleanly
  db.update(headshots)
    .set({ status: row.renderer === "canva" ? "autofilling" : "rendering", errorMessage: null, updatedAt: Date.now() })
    .where(eq(headshots.id, row.id))
    .run();
  if (row.renderer === "canva") startHeadshotCanva(db, makeDriveClient(drive), row.id);
  else startHeadshot(db, makeDriveClient(drive), row.id);
  return NextResponse.json({ ok: true });
}
