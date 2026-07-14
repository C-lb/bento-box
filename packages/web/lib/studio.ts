// packages/web/lib/studio.ts
import { resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { runHeadshotRender, runHeadshotCanva, type CanvaRenderDeps } from "@event-editor/core/headshot";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient } from "./google/drive";
import { renderHeadshot } from "./headshot-render";
import type { CanvaClient } from "./canva/client";
import { makeCanvaClient } from "./canva/client";
import { resolveTemplateFields } from "./canva/fields";

type Db = ReturnType<typeof openDb>;

export const HEADSHOT_DIR = process.env.EE_HEADSHOT_DIR ?? "data/headshots";

// drive may be null when the source is a local upload (Drive never touched).
const noDrive = (): Promise<Buffer> =>
  Promise.reject(new Error("Google Drive is not connected"));

export function startHeadshot(db: Db, drive: DriveClient | null, id: number): void {
  void runHeadshotRender(db, id, {
    loadPhoto: (fileId) => (drive ? drive.downloadFile(fileId) : noDrive()),
    loadUpload: (path) => readFile(resolve(path)),
    render: (photo, frame, name, title) => renderHeadshot(photo, frame, name, title),
    save: async (hid, png) => {
      await mkdir(resolve(HEADSHOT_DIR), { recursive: true });
      const rel = `${HEADSHOT_DIR}/${hid}.png`;
      await writeFile(resolve(rel), png);
      return rel;
    },
  });
}

export function buildCanvaDeps(drive: DriveClient | null, canva: CanvaClient): CanvaRenderDeps {
  return {
    loadPhoto: (fileId) => (drive ? drive.downloadFile(fileId) : noDrive()),
    loadUpload: (path) => readFile(resolve(path)),
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

export function startHeadshotCanva(db: Db, drive: DriveClient | null, id: number): void {
  void runHeadshotCanva(db, id, buildCanvaDeps(drive, makeCanvaClient(db)));
}
