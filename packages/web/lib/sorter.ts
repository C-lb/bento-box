import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createScanJob, runIngest } from "@event-editor/core/ingest";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient, DriveImage } from "./google/drive.js";

type Db = ReturnType<typeof openDb>;

export function startScan(
  db: Db,
  drive: DriveClient,
  args: { folderId: string; folderName: string },
): number {
  const jobId = createScanJob(db, { driveFolderId: args.folderId, driveFolderName: args.folderName });
  // fire-and-forget: ingest runs in the background, mutating the job row
  void runIngest(db, jobId, args.folderId, {
    listImages: (folderId) => drive.listImages(folderId),
    saveThumbnail: async (jId, pId, image) => {
      const bytes = await drive.downloadThumbnail(image as DriveImage);
      if (!bytes) return null;
      const dir = resolve("data/thumbs", String(jId));
      await mkdir(dir, { recursive: true });
      const rel = `data/thumbs/${jId}/${pId}.jpg`;
      await writeFile(resolve("data/thumbs", String(jId), `${pId}.jpg`), bytes);
      return rel;
    },
  });
  return jobId;
}
