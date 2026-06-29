// packages/web/lib/studio.ts
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runHeadshotRender } from "@event-editor/core/headshot";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient } from "./google/drive";
import { renderHeadshot } from "./headshot-render";

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
