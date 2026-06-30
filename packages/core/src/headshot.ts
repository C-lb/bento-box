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

export interface CreateCanvaHeadshotArgs {
  driveFileId: string;
  canvaTemplateId: string;
  nameText: string;
  titleText: string;
}

export function createCanvaHeadshot(db: BetterSQLite3Database<any>, args: CreateCanvaHeadshotArgs): number {
  const now = Date.now();
  const res = db
    .insert(headshots)
    .values({
      source: "drive",
      sourceDriveFileId: args.driveFileId,
      renderer: "canva",
      canvaTemplateId: args.canvaTemplateId,
      templateId: null,
      nameText: args.nameText,
      titleText: args.titleText,
      status: "autofilling",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

export interface CanvaRenderDeps {
  loadPhoto(driveFileId: string): Promise<Buffer>;
  getDataset(templateId: string): Promise<{ fields: { name: string; type: string }[] }>;
  resolveFields(dataset: { fields: { name: string; type: string }[] }): { photo: string; name: string; title: string };
  uploadAsset(photo: Buffer, name: string): Promise<string>;
  autofill(
    templateId: string,
    data: Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>,
  ): Promise<string>;
  exportPng(designId: string): Promise<string>;
  download(url: string): Promise<Buffer>;
  save(id: number, png: Buffer): Promise<string>;
}

export async function runHeadshotCanva(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: CanvaRenderDeps,
): Promise<void> {
  try {
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    if (!row) throw new Error(`headshot ${id} not found`);
    const templateId = row.canvaTemplateId;
    if (!templateId) throw new Error(`headshot ${id} has no canva template`);

    const dataset = await deps.getDataset(templateId);
    const fields = deps.resolveFields(dataset);

    const photo = await deps.loadPhoto(row.sourceDriveFileId!);
    const assetId = await deps.uploadAsset(photo, `headshot-${id}`);
    const data = {
      [fields.photo]: { type: "image" as const, asset_id: assetId },
      [fields.name]: { type: "text" as const, text: row.nameText ?? "" },
      [fields.title]: { type: "text" as const, text: row.titleText ?? "" },
    };
    const designId = await deps.autofill(templateId, data);
    touch(db, id, { designId, status: "exporting" });

    const url = await deps.exportPng(designId);
    touch(db, id, { exportUrl: url });
    const png = await deps.download(url);
    const path = await deps.save(id, png);
    touch(db, id, { outputPath: path, status: "done" });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
