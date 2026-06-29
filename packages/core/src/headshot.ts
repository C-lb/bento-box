// packages/core/src/headshot.ts
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { headshots } from "./schema/index.js";
import { getFrame, type FrameSpec } from "./frames.js";

export interface HeadshotRenderDeps {
  loadPhoto(driveFileId: string): Promise<Buffer>;
  render(photo: Buffer, frame: FrameSpec, nameText: string, titleText: string): Promise<Buffer>;
  save(id: number, png: Buffer): Promise<string>;
}

export interface CreateHeadshotArgs {
  driveFileId: string;
  frameId: string;
  nameText: string;
  titleText: string;
}

function touch(db: BetterSQLite3Database<any>, id: number, set: Record<string, unknown>) {
  db.update(headshots).set({ ...set, updatedAt: Date.now() }).where(eq(headshots.id, id)).run();
}

export function createHeadshot(db: BetterSQLite3Database<any>, args: CreateHeadshotArgs): number {
  const now = Date.now();
  const res = db
    .insert(headshots)
    .values({
      source: "drive",
      sourceDriveFileId: args.driveFileId,
      renderer: "local",
      canvaTemplateId: null,
      templateId: args.frameId,
      nameText: args.nameText,
      titleText: args.titleText,
      status: "rendering",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

export async function runHeadshotRender(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: HeadshotRenderDeps,
): Promise<void> {
  try {
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    if (!row) throw new Error(`headshot ${id} not found`);
    const frame = getFrame(row.templateId ?? "");
    if (!frame) throw new Error(`unknown frame: ${row.templateId}`);

    const photo = await deps.loadPhoto(row.sourceDriveFileId!);
    const png = await deps.render(photo, frame, row.nameText ?? "", row.titleText ?? "");
    const path = await deps.save(id, png);
    touch(db, id, { outputPath: path, status: "done" });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
