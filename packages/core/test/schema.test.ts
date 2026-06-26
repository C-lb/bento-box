import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, jobs } from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-test-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

describe("schema", () => {
  it("migrates and round-trips a job row", () => {
    const db = freshDb();
    db.insert(jobs).values({
      driveFolderId: "folder-1",
      driveFolderName: "Headshots",
      status: "scanning",
    }).run();
    const rows = db.select().from(jobs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("scanning");
    expect(rows[0].processed).toBe(0);
  });

  it("is idempotent when run twice", () => {
    const db = freshDb();
    expect(() => runMigrations(db)).not.toThrow();
  });
});
