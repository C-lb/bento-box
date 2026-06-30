import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import { addColumnIfMissing } from "../src/migrate.js";

function cols(db: ReturnType<typeof openDb>, table: string): string[] {
  const rows = db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe("batch_id migration", () => {
  it("fresh db has batch_id on headshots", () => {
    const db = openDb(join(tmpdir(), `ee-bm-${Math.random().toString(36).slice(2)}.db`));
    runMigrations(db);
    expect(cols(db, "headshots")).toContain("batch_id");
  });

  it("addColumnIfMissing adds to a pre-existing table and is idempotent", () => {
    const db = openDb(join(tmpdir(), `ee-bm-${Math.random().toString(36).slice(2)}.db`));
    // simulate a 4b-era headshots table without batch_id
    db.run(sql.raw("CREATE TABLE headshots (id INTEGER PRIMARY KEY, renderer TEXT)"));
    addColumnIfMissing(db, "headshots", "batch_id", "TEXT");
    expect(cols(db, "headshots")).toContain("batch_id");
    // second call is a no-op, no throw
    addColumnIfMissing(db, "headshots", "batch_id", "TEXT");
    expect(cols(db, "headshots").filter((c) => c === "batch_id")).toHaveLength(1);
  });

  it("runMigrations is idempotent on batch_id", () => {
    const db = openDb(join(tmpdir(), `ee-bm-${Math.random().toString(36).slice(2)}.db`));
    runMigrations(db);
    runMigrations(db);
    expect(cols(db, "headshots").filter((c) => c === "batch_id")).toHaveLength(1);
  });
});
