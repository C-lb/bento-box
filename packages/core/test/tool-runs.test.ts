import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import { createToolRun, listToolRuns, deleteToolRun, isToolRunTool, TOOL_RUN_TOOLS } from "../src/tool-runs.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-tr-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("tool-runs", () => {
  it("is empty by default", () => {
    expect(listToolRuns(freshDb(), "pdf")).toEqual([]);
  });

  it("creates a run and lists it with parsed outputs", () => {
    const db = freshDb();
    const id = createToolRun(db, {
      tool: "pdf",
      label: "report.pdf",
      mode: "compress",
      outputs: [{ id: "j1", filename: "report-tidied.pdf" }],
    });
    const rows = listToolRuns(db, "pdf");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      tool: "pdf",
      label: "report.pdf",
      mode: "compress",
      outputs: [{ id: "j1", filename: "report-tidied.pdf" }],
    });
    expect(rows[0].createdAt).toBeGreaterThan(0);
  });

  it("defaults mode to null and scopes listing by tool", () => {
    const db = freshDb();
    createToolRun(db, { tool: "video", label: "clip.mov", outputs: [{ id: "v1", filename: "clip-compressed.mp4" }] });
    createToolRun(db, { tool: "resize", label: "photo.png", outputs: [{ id: "r1", filename: "photo-resized.png" }] });
    const video = listToolRuns(db, "video");
    expect(video).toHaveLength(1);
    expect(video[0].mode).toBeNull();
    expect(listToolRuns(db, "resize")).toHaveLength(1);
    expect(listToolRuns(db, "pdf")).toEqual([]);
  });

  it("orders newest first by createdAt", () => {
    const db = freshDb();
    const oldId = createToolRun(db, { tool: "pdf", label: "old.pdf", outputs: [] });
    const newId = createToolRun(db, { tool: "pdf", label: "new.pdf", outputs: [] });
    db.run(sql.raw(`UPDATE tool_runs SET created_at = 1 WHERE id = '${oldId}'`));
    db.run(sql.raw(`UPDATE tool_runs SET created_at = 2 WHERE id = '${newId}'`));
    expect(listToolRuns(db, "pdf").map((r) => r.id)).toEqual([newId, oldId]);
  });

  it("deletes a run only under its own tool", () => {
    const db = freshDb();
    const id = createToolRun(db, { tool: "splice", label: "a.mp4", mode: "trim", outputs: [] });
    deleteToolRun(db, "pdf", id);
    expect(listToolRuns(db, "splice")).toHaveLength(1);
    deleteToolRun(db, "splice", id);
    expect(listToolRuns(db, "splice")).toEqual([]);
  });

  it("prunes to the newest 50 rows per tool without touching other tools", () => {
    const db = freshDb();
    createToolRun(db, { tool: "resize", label: "keep-me.png", outputs: [] });
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      const id = createToolRun(db, { tool: "pdf", label: `doc-${i}.pdf`, outputs: [] });
      // Distinct timestamps so prune ordering is deterministic.
      db.run(sql.raw(`UPDATE tool_runs SET created_at = ${1000 + i} WHERE id = '${id}'`));
      ids.push(id);
    }
    const rows = listToolRuns(db, "pdf");
    expect(rows).toHaveLength(50);
    // The five oldest are gone; the newest survives.
    expect(rows[0].label).toBe("doc-54.pdf");
    expect(rows.map((r) => r.id)).not.toContain(ids[0]);
    expect(rows.map((r) => r.id)).not.toContain(ids[4]);
    expect(rows.map((r) => r.id)).toContain(ids[5]);
    expect(listToolRuns(db, "resize")).toHaveLength(1);
  });

  it("tolerates malformed outputs JSON", () => {
    const db = freshDb();
    const id = createToolRun(db, { tool: "convert", label: "song.mp3", mode: "file", outputs: [] });
    db.run(sql.raw(`UPDATE tool_runs SET outputs = 'not-json' WHERE id = '${id}'`));
    expect(listToolRuns(db, "convert")[0].outputs).toEqual([]);
  });

  it("exposes the tool whitelist", () => {
    expect(TOOL_RUN_TOOLS).toEqual(["pdf", "resize", "video", "splice", "convert"]);
    expect(isToolRunTool("pdf")).toBe(true);
    expect(isToolRunTool("heic")).toBe(false);
  });
});
