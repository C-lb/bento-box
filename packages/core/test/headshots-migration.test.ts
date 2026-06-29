import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";

function cols(db: ReturnType<typeof openDb>): Array<{ name: string; notnull: number }> {
  return db.all(sql.raw("PRAGMA table_info(headshots)")) as Array<{ name: string; notnull: number }>;
}

describe("headshots migration", () => {
  it("fresh db has the generalized columns and nullable canva_template_id", () => {
    const db = openDb(join(tmpdir(), `ee-hm-${Math.random().toString(36).slice(2)}.db`));
    runMigrations(db);
    const c = cols(db);
    const names = new Set(c.map((r) => r.name));
    for (const n of ["renderer", "template_id", "output_path", "source_drive_file_id"]) {
      expect(names.has(n)).toBe(true);
    }
    expect(c.find((r) => r.name === "canva_template_id")!.notnull).toBe(0);
  });

  it("rebuilds a legacy headshots table without dropping rows, idempotently", () => {
    const db = openDb(join(tmpdir(), `ee-hm-${Math.random().toString(36).slice(2)}.db`));
    // simulate the old (Canva-only) shape with a row in it
    db.run(sql.raw(`CREATE TABLE headshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_photo_id INTEGER,
      source_upload_path TEXT,
      canva_template_id TEXT NOT NULL,
      name_text TEXT, title_text TEXT,
      autofill_job_id TEXT, design_id TEXT,
      status TEXT NOT NULL DEFAULT 'autofilling',
      export_url TEXT, error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0)`));
    db.run(sql.raw(`INSERT INTO headshots (source, canva_template_id, status) VALUES ('upload','T1','done')`));

    runMigrations(db);
    runMigrations(db); // second run must be a no-op, not a re-rebuild error

    const names = new Set(cols(db).map((r) => r.name));
    expect(names.has("renderer")).toBe(true);
    expect(names.has("output_path")).toBe(true);
    const rows = db.all(sql.raw("SELECT source, canva_template_id, renderer FROM headshots")) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe("upload");
    expect(rows[0].renderer).toBe("local"); // default backfilled on rebuild
  });
});
