import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { runMigrations } from "../src/migrate.js";

describe("transcriptions migration columns", () => {
  it("adds context and format columns", () => {
    const db = drizzle(new Database(":memory:"));
    runMigrations(db as any);
    const cols = (db.all(sql.raw("PRAGMA table_info(transcriptions)")) as Array<{ name: string }>).map((r) => r.name);
    for (const c of ["context_file_path", "context_text", "event_details", "summary_linkedin", "summary_article"]) {
      expect(cols).toContain(c);
    }
  });
});
