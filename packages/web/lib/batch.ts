import { matchRow, type RowMatch } from "@event-editor/core/match";
import type { openDb } from "@event-editor/core/db";
import type { DriveClient } from "./google/drive";
import { startHeadshot, startHeadshotCanva } from "./studio";

type Db = ReturnType<typeof openDb>;

export const BATCH_CONCURRENCY = Number(process.env.EE_BATCH_CONCURRENCY) || 3;

export async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      try {
        await worker(next[1]);
      } catch {
        // per-item failure is isolated; the row records its own error
      }
    }
  });
  await Promise.all(runners);
}

export function matchSheetRows(args: {
  header: string[];
  rows: string[][];
  mapping: { name: number; title: number | null; photo: number | null };
  folderFiles: { id: string; name: string }[];
}): { index: number; name: string; title: string; match: RowMatch }[] {
  const { mapping, folderFiles } = args;
  return args.rows.map((row, index) => {
    const name = (row[mapping.name] ?? "").trim();
    const title = mapping.title != null ? (row[mapping.title] ?? "").trim() : "";
    const photoCell = mapping.photo != null ? (row[mapping.photo] ?? "").trim() : undefined;
    return { index, name, title, match: matchRow({ name, photoCell, folderFiles }) };
  });
}

export function runBatch(db: Db, drive: DriveClient, renderer: "local" | "canva", ids: number[]): void {
  void runWithConcurrency(ids, BATCH_CONCURRENCY, async (id) => {
    if (renderer === "canva") startHeadshotCanva(db, drive, id);
    else startHeadshot(db, drive, id);
  });
}
