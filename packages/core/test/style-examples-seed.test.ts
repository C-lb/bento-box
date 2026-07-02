import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { runMigrations, seedStyleExamples } from "../src/migrate";

function freshDb() {
  const sqlite = new Database(":memory:");
  return drizzle(sqlite);
}

describe("seedStyleExamples", () => {
  it("seeds built-in examples for both formats on first run", () => {
    const db = freshDb();
    runMigrations(db as any);
    const li = db.all(sql.raw("SELECT * FROM style_examples WHERE format='linkedin'")) as any[];
    const art = db.all(sql.raw("SELECT * FROM style_examples WHERE format='article'")) as any[];
    expect(li.length).toBeGreaterThan(0);
    expect(art.length).toBeGreaterThan(0);
    expect(li.every((r) => r.kind === "seed")).toBe(true);
  });

  it("does not re-seed when rows already exist", () => {
    const db = freshDb();
    runMigrations(db as any);
    const before = (db.all(sql.raw("SELECT COUNT(*) AS n FROM style_examples")) as any[])[0].n;
    seedStyleExamples(db as any);
    const after = (db.all(sql.raw("SELECT COUNT(*) AS n FROM style_examples")) as any[])[0].n;
    expect(after).toBe(before);
  });
});
