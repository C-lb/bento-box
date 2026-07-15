import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Real sqlite db in a temp dir; @/lib/db opens EE_DB_PATH lazily so setting it
// before the first request is enough (see runs-route.test.ts).
const tmp = mkdtempSync(resolve(tmpdir(), "studiobatches-"));
process.env.EE_DB_PATH = resolve(tmp, "app.db");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { openDb } from "@event-editor/core/db";
import { runMigrations } from "@event-editor/core/migrate";
import { headshots } from "@event-editor/core/schema";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { GET as listHeadshots } from "@/app/api/studio/headshots/route";
import { DELETE as deleteBatch, GET as getBatch } from "@/app/api/studio/batch/[batchId]/route";

runMigrations(openDb(process.env.EE_DB_PATH));

const params = (batchId: string) => ({ params: Promise.resolve({ batchId }) });

function insertShot(args: {
  batchId: string | null;
  status?: string;
  createdAt?: number;
  outputPath?: string | null;
}): void {
  getDb()
    .insert(headshots)
    .values({
      source: "drive",
      renderer: "local",
      status: args.status ?? "done",
      batchId: args.batchId,
      createdAt: args.createdAt ?? 0,
      updatedAt: args.createdAt ?? 0,
      outputPath: args.outputPath ?? null,
    })
    .run();
}

function makeOutputFile(name: string): string {
  const p = resolve(tmp, name);
  writeFileSync(p, "png-bytes");
  return p;
}

describe("GET /api/studio/headshots?grouped=1", () => {
  it("groups rows by batchId with counts, newest batch first, excluding single headshots", async () => {
    insertShot({ batchId: null, createdAt: 999 }); // single-tab shot: not a batch
    insertShot({ batchId: "b-old", createdAt: 100 });
    insertShot({ batchId: "b-old", createdAt: 110, status: "error" });
    insertShot({ batchId: "b-new", createdAt: 200 });
    insertShot({ batchId: "b-new", createdAt: 210 });
    insertShot({ batchId: "b-new", createdAt: 220 });

    const res = await listHeadshots(new Request("http://x/api/studio/headshots?grouped=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batches).toEqual([
      { batchId: "b-new", count: 3, doneCount: 3, createdAt: 200 },
      { batchId: "b-old", count: 2, doneCount: 1, createdAt: 100 },
    ]);
  });

  it("still returns the flat headshot list without the param", async () => {
    const res = await listHeadshots(new Request("http://x/api/studio/headshots"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.headshots)).toBe(true);
    expect(body.batches).toBeUndefined();
  });
});

describe("DELETE /api/studio/batch/[batchId]", () => {
  it("removes the batch's rows and their output files, leaving other batches alone", async () => {
    const f1 = makeOutputFile("del-1.png");
    const f2 = makeOutputFile("del-2.png");
    const keep = makeOutputFile("keep.png");
    insertShot({ batchId: "b-del", createdAt: 300, outputPath: f1 });
    insertShot({ batchId: "b-del", createdAt: 301, outputPath: f2 });
    insertShot({ batchId: "b-keep", createdAt: 302, outputPath: keep });

    const res = await deleteBatch(new Request("http://x"), params("b-del"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Rows gone, files gone.
    const rows = getDb().select().from(headshots).where(eq(headshots.batchId, "b-del")).all();
    expect(rows).toHaveLength(0);
    expect(existsSync(f1)).toBe(false);
    expect(existsSync(f2)).toBe(false);

    // Other batch untouched.
    const kept = await (await getBatch(new Request("http://x"), params("b-keep"))).json();
    expect(kept.headshots).toHaveLength(1);
    expect(existsSync(keep)).toBe(true);
  });

  it("is a no-op ok for an unknown batchId", async () => {
    const res = await deleteBatch(new Request("http://x"), params("nope"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
