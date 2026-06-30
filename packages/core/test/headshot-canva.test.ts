// packages/core/test/headshot-canva.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "../src/index.js";
import { createCanvaHeadshot, runHeadshotCanva, type CanvaRenderDeps } from "../src/headshot.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-hsc-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

const dataset = { fields: [
  { name: "photo", type: "image" }, { name: "name", type: "text" }, { name: "title", type: "text" },
] };

function happyDeps(calls: string[]): CanvaRenderDeps {
  return {
    loadPhoto: async () => Buffer.from("img"),
    getDataset: async () => dataset,
    resolveFields: () => ({ photo: "photo", name: "name", title: "title" }),
    uploadAsset: async () => { calls.push("upload"); return "asset1"; },
    autofill: async (_t, data) => { calls.push("autofill:" + JSON.stringify(data.photo)); return "design1"; },
    exportPng: async () => { calls.push("export"); return "https://x/y.png"; },
    download: async () => Buffer.from("png"),
    save: async () => "data/headshots/1.png",
  };
}

let db: ReturnType<typeof freshDb>;
beforeEach(() => { db = freshDb(); });

describe("runHeadshotCanva", () => {
  it("walks autofilling -> exporting -> done and stores ids", async () => {
    const id = createCanvaHeadshot(db, { driveFileId: "f1", canvaTemplateId: "t1", nameText: "Ada", titleText: "CTO" });
    const before = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(before.status).toBe("autofilling");
    expect(before.renderer).toBe("canva");

    const calls: string[] = [];
    await runHeadshotCanva(db, id, happyDeps(calls));
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(row.status).toBe("done");
    expect(row.designId).toBe("design1");
    expect(row.exportUrl).toBe("https://x/y.png");
    expect(row.outputPath).toBe("data/headshots/1.png");
    expect(calls).toEqual(["upload", 'autofill:{"type":"image","asset_id":"asset1"}', "export"]);
  });

  it("records error on a 403-style failure", async () => {
    const id = createCanvaHeadshot(db, { driveFileId: "f1", canvaTemplateId: "t1", nameText: "Ada", titleText: "CTO" });
    const deps = happyDeps([]);
    deps.exportPng = async () => { throw new Error("needs Canva Teams/Enterprise"); };
    await runHeadshotCanva(db, id, deps);
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toMatch(/Teams\/Enterprise/);
  });

  it("errors clearly when fields are missing", async () => {
    const id = createCanvaHeadshot(db, { driveFileId: "f1", canvaTemplateId: "t1", nameText: "Ada", titleText: "CTO" });
    const deps = happyDeps([]);
    deps.resolveFields = () => { throw new Error("missing required fields: name (text field)"); };
    await runHeadshotCanva(db, id, deps);
    const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toMatch(/missing required fields/);
  });
});
