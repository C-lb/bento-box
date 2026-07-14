import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { createScanJob, runIngest } from "@event-editor/core/ingest";
import { runRanking } from "@event-editor/core/ranking";
import { jobs } from "@event-editor/core/schema";
import type { openDb } from "@event-editor/core/db";
import { getRankingContext, type Platform } from "@event-editor/core/ranking-context";
import type { DriveClient, DriveImage } from "./google/drive.js";
import { computeMetrics } from "./metrics";
import { visionClient, scorePhoto } from "./anthropic";
import { thumbsDir } from "./paths";

type Db = ReturnType<typeof openDb>;

async function withBackoff<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.statusCode;
      if (status !== 429 && status !== 529) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

export function startScan(
  db: Db,
  drive: DriveClient,
  args: { folderId: string; folderName: string; platform: Platform; includeSubfolders?: boolean },
): number {
  const jobId = createScanJob(db, { driveFolderId: args.folderId, driveFolderName: args.folderName, platform: args.platform });

  void (async () => {
    await runIngest(
      db,
      jobId,
      args.folderId,
      {
        listImages: (folderId) =>
          args.includeSubfolders ? drive.listImagesDeep(folderId) : drive.listImages(folderId),
        saveThumbnail: async (jId, pId, image) => {
          const raw = await drive.downloadThumbnail(image as DriveImage);
          if (!raw) return null;
          // Drive thumbnail bytes are often PNG/WebP. Re-encode to JPEG so the
          // .jpg filename, the /api/thumb content-type, and the vision call's
          // declared media_type all agree — otherwise Anthropic 400s the image.
          const bytes = await sharp(raw).jpeg().toBuffer();
          const root = thumbsDir();
          await mkdir(resolve(root, String(jId)), { recursive: true });
          await writeFile(resolve(root, String(jId), `${pId}.jpg`), bytes);
          return resolve(root, String(jId), `${pId}.jpg`);
        },
      },
      { completeStatus: "heuristics" },
    );

    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
    if (!job || job.status === "error") return;

    // Preflight the key before constructing the client: `new Anthropic()` throws
    // synchronously when ANTHROPIC_API_KEY is unset, and that throw would land
    // outside runRanking's try/catch, stranding the job at "heuristics" forever.
    if (!process.env.ANTHROPIC_API_KEY) {
      db.update(jobs)
        .set({ status: "error", errorMessage: "ANTHROPIC_API_KEY is not set", updatedAt: Date.now() })
        .where(eq(jobs.id, jobId))
        .run();
      return;
    }

    const client = visionClient();
    const context = getRankingContext(db, args.platform);
    await runRanking(db, jobId, {
      getMetrics: (photo) => computeMetrics(resolve(photo.thumbnailPath!), { width: photo.width, height: photo.height }),
      scoreVision: async (photo) => {
        const bytes = await readFile(resolve(photo.thumbnailPath!));
        return withBackoff(() =>
          scorePhoto(client, { base64: bytes.toString("base64"), mediaType: "image/jpeg", name: photo.name }, context),
        );
      },
    }, args.platform);
  })();

  return jobId;
}
