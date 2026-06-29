// packages/core/test/headshot.test.ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, headshots } from "../src/index.js";
import { createHeadshot, runHeadshotRender } from "../src/headshot.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-hs-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}
const row = (db: any, id: number) =>
  db.select().from(headshots).where(eq(headshots.id, id)).all()[0];

describe("headshot pipeline", () => {
  it("createHeadshot inserts a local row in rendering status", () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    const r = row(db, id);
    expect(r.renderer).toBe("local");
    expect(r.status).toBe("rendering");
    expect(r.templateId).toBe("circle");
    expect(r.sourceDriveFileId).toBe("f1");
  });

  it("runHeadshotRender drives the row to done with an output path", async () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    const calls: string[] = [];
    await runHeadshotRender(db, id, {
      loadPhoto: async (fid) => { calls.push(`load:${fid}`); return Buffer.from("photo"); },
      render: async (_p, frame) => { calls.push(`render:${frame.id}`); return Buffer.from("png"); },
      save: async (hid, png) => { calls.push(`save:${hid}:${png.length}`); return `data/headshots/${hid}.png`; },
    });
    const r = row(db, id);
    expect(r.status).toBe("done");
    expect(r.outputPath).toBe(`data/headshots/${id}.png`);
    expect(calls).toEqual(["load:f1", "render:circle", `save:${id}:3`]);
  });

  it("marks the row errored when a dependency throws", async () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "circle", nameText: "Jane", titleText: "Lead" });
    await runHeadshotRender(db, id, {
      loadPhoto: async () => { throw new Error("drive boom"); },
      render: async () => Buffer.from("png"),
      save: async () => "x",
    });
    const r = row(db, id);
    expect(r.status).toBe("error");
    expect(r.errorMessage).toContain("drive boom");
  });

  it("errors on an unknown frame id", async () => {
    const db = freshDb();
    const id = createHeadshot(db, { driveFileId: "f1", frameId: "ghost", nameText: "", titleText: "" });
    await runHeadshotRender(db, id, {
      loadPhoto: async () => Buffer.from("p"),
      render: async () => Buffer.from("png"),
      save: async () => "x",
    });
    expect(row(db, id).status).toBe("error");
  });
});
