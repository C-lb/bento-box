import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runMigrations } from "../src/migrate";
import { listExamples, promptExamples, addExample, updateExample, deleteExample, toggleLiked, isLiked } from "../src/style-examples";

function db() {
  const d = drizzle(new Database(":memory:"));
  runMigrations(d as any);
  return d as any;
}

describe("style-examples", () => {
  it("promptExamples returns seed+custom then last-3 liked", () => {
    const d = db();
    addExample(d, "linkedin", "custom", "CUSTOM1");
    for (let i = 1; i <= 5; i++) addExample(d, "linkedin", "liked", `LIKED${i}`);
    const out = promptExamples(d, "linkedin");
    expect(out).toContain("CUSTOM1");
    // only 3 most recent liked (LIKED5, LIKED4, LIKED3)
    const likedInOut = out.filter((t) => t.startsWith("LIKED"));
    expect(likedInOut.length).toBe(3);
    expect(likedInOut).toEqual(["LIKED5", "LIKED4", "LIKED3"]);
  });

  it("toggleLiked inserts then removes by text", () => {
    const d = db();
    expect(toggleLiked(d, "article", "DRAFT").liked).toBe(true);
    expect(isLiked(d, "article", "DRAFT")).toBe(true);
    expect(toggleLiked(d, "article", "DRAFT").liked).toBe(false);
    expect(isLiked(d, "article", "DRAFT")).toBe(false);
  });

  it("add/update/delete custom", () => {
    const d = db();
    const item = addExample(d, "linkedin", "custom", "A");
    updateExample(d, item.id, "B");
    expect(listExamples(d, "linkedin").custom.map((c) => c.text)).toContain("B");
    deleteExample(d, item.id);
    expect(listExamples(d, "linkedin").custom.map((c) => c.text)).not.toContain("B");
  });
});
