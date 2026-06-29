// packages/web/test/studio.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "@event-editor/core";
import { createHeadshot } from "@event-editor/core/headshot";

const OUT = mkdtempSync(join(tmpdir(), "ee-hsout-"));
process.env.EE_HEADSHOT_DIR = OUT;

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-st-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("startHeadshot", () => {
  it("renders a real png to disk and marks the row done", async () => {
    const { startHeadshot } = await import("../lib/studio"); // import after env set
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "F1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    const fakeDrive = {
      async downloadFile() {
        return sharp({ create: { width: 300, height: 300, channels: 3, background: "#3366cc" } }).png().toBuffer();
      },
    };
    startHeadshot(db, fakeDrive as any, id);

    // poll the row (async pipeline)
    for (let i = 0; i < 50; i++) {
      const r = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
      if (r.status === "done" || r.status === "error") break;
      await new Promise((res) => setTimeout(res, 40));
    }
    const r = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(r.status).toBe("done");
    expect(r.outputPath).toBe(`${OUT}/${id}.png`);
    expect(existsSync(r.outputPath!)).toBe(true);
  });
});
