import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "../src/index.js";
import { createBatchHeadshots } from "../src/headshot.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-bc-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("createBatchHeadshots", () => {
  it("creates canva rows tagged with the batch id", () => {
    const db = freshDb();
    const ids = createBatchHeadshots(db, {
      batchId: "b1", renderer: "canva", styleId: "tmpl1",
      rows: [
        { driveFileId: "f1", nameText: "Ada", titleText: "CTO" },
        { driveFileId: "f2", nameText: "Linus", titleText: "Eng" },
      ],
    });
    expect(ids).toHaveLength(2);
    const rows = db.select().from(headshots).all();
    expect(rows.every((r) => r.batchId === "b1")).toBe(true);
    expect(rows.every((r) => r.renderer === "canva")).toBe(true);
    expect(rows.every((r) => r.canvaTemplateId === "tmpl1")).toBe(true);
    expect(rows.every((r) => r.status === "autofilling")).toBe(true);
    expect(rows.map((r) => r.nameText).sort()).toEqual(["Ada", "Linus"]);
  });

  it("creates local rows with the frame as template_id", () => {
    const db = freshDb();
    const ids = createBatchHeadshots(db, {
      batchId: "b2", renderer: "local", styleId: "circle",
      rows: [{ driveFileId: "f3", nameText: "Grace", titleText: "Adm" }],
    });
    const r = db.select().from(headshots).where(eq(headshots.id, ids[0])).all()[0];
    expect(r.renderer).toBe("local");
    expect(r.templateId).toBe("circle");
    expect(r.canvaTemplateId).toBeNull();
    expect(r.status).toBe("rendering");
    expect(r.batchId).toBe("b2");
  });

  it("threads a preset style onto every local row", () => {
    const db = freshDb();
    const style = { fontId: "inter", name: { bold: true }, rim: { mode: "gradient" as const, width: 18, from: "#ec4899", to: "#7c3aed", angle: 45 } };
    const ids = createBatchHeadshots(db, {
      batchId: "b3", renderer: "local", styleId: "circle", style,
      rows: [
        { driveFileId: "f4", nameText: "Ada", titleText: "CTO" },
        { driveFileId: "f5", nameText: "Grace", titleText: "Adm" },
      ],
    });
    const rows = db.select().from(headshots).all();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(JSON.parse(r.styleJson!)).toMatchObject(style);
    }
    // Canva ignores style: no styleJson written.
    const cdb = freshDb();
    const cids = createBatchHeadshots(cdb, {
      batchId: "b4", renderer: "canva", styleId: "tmpl", style,
      rows: [{ driveFileId: "f6", nameText: "X", titleText: "Y" }],
    });
    expect(cdb.select().from(headshots).where(eq(headshots.id, cids[0])).all()[0].styleJson).toBeNull();
  });
});
