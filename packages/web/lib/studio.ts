// packages/web/lib/studio.ts
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runHeadshotRender, runHeadshotCanva, type CanvaRenderDeps } from "@event-editor/core/headshot";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient } from "./google/drive";
import { renderHeadshot } from "./headshot-render";
import type { CanvaClient } from "./canva/client";
import { makeCanvaClient } from "./canva/client";
import { resolveTemplateFields } from "./canva/fields";

type Db = ReturnType<typeof openDb>;

export const HEADSHOT_DIR = process.env.EE_HEADSHOT_DIR ?? "data/headshots";

export function startHeadshot(db: Db, drive: DriveClient, id: number): void {
  void runHeadshotRender(db, id, {
    loadPhoto: (fileId) => drive.downloadFile(fileId),
    render: (photo, frame, name, title) => renderHeadshot(photo, frame, name, title),
    save: async (hid, png) => {
      await mkdir(resolve(HEADSHOT_DIR), { recursive: true });
      const rel = `${HEADSHOT_DIR}/${hid}.png`;
      await writeFile(resolve(rel), png);
      return rel;
    },
  });
}

export function buildCanvaDeps(drive: DriveClient, canva: CanvaClient): CanvaRenderDeps {
  return {
    loadPhoto: (fileId) => drive.downloadFile(fileId),
    getDataset: (templateId) => canva.getDataset(templateId),
    resolveFields: (dataset) => resolveTemplateFields(dataset),
    uploadAsset: (photo, name) => canva.uploadAsset(photo, name),
    autofill: (templateId, data) => canva.createAutofill(templateId, data),
    exportPng: (designId) => canva.exportPng(designId),
    download: (url) => canva.download(url),
    save: async (hid, png) => {
      await mkdir(resolve(HEADSHOT_DIR), { recursive: true });
      const rel = `${HEADSHOT_DIR}/${hid}.png`;
      await writeFile(resolve(rel), png);
      return rel;
    },
  };
}

export function startHeadshotCanva(db: Db, drive: DriveClient, id: number): void {
  void runHeadshotCanva(db, id, buildCanvaDeps(drive, makeCanvaClient(db)));
}
