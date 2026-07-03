import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations } from "../src/index.js";
import {
  getRankingContext,
  setRankingContext,
  resetRankingContext,
  defaultContext,
  isPlatform,
  isEditablePlatform,
  INSTAGRAM_DEFAULT,
  LINKEDIN_DEFAULT,
  PROFILE_CONTEXT,
} from "../src/ranking-context.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-rc-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("ranking-context", () => {
  it("returns the built-in default when nothing is stored", () => {
    const db = freshDb();
    expect(getRankingContext(db, "instagram")).toBe(INSTAGRAM_DEFAULT);
    expect(getRankingContext(db, "linkedin")).toBe(LINKEDIN_DEFAULT);
  });

  it("returns the fixed profile context and never reads a row for it", () => {
    const db = freshDb();
    expect(getRankingContext(db, "profile")).toBe(PROFILE_CONTEXT);
    expect(defaultContext("profile")).toBe(PROFILE_CONTEXT);
  });

  it("stores and reads back an edited context", () => {
    const db = freshDb();
    setRankingContext(db, "instagram", "my custom ig criteria");
    expect(getRankingContext(db, "instagram")).toBe("my custom ig criteria");
    // linkedin untouched
    expect(getRankingContext(db, "linkedin")).toBe(LINKEDIN_DEFAULT);
  });

  it("upserts on repeated sets", () => {
    const db = freshDb();
    setRankingContext(db, "linkedin", "first");
    setRankingContext(db, "linkedin", "second");
    expect(getRankingContext(db, "linkedin")).toBe("second");
  });

  it("reset deletes the row so the default returns", () => {
    const db = freshDb();
    setRankingContext(db, "instagram", "temp");
    resetRankingContext(db, "instagram");
    expect(getRankingContext(db, "instagram")).toBe(INSTAGRAM_DEFAULT);
  });

  it("guards platform strings", () => {
    expect(isPlatform("instagram")).toBe(true);
    expect(isPlatform("profile")).toBe(true);
    expect(isPlatform("tiktok")).toBe(false);
    expect(isEditablePlatform("linkedin")).toBe(true);
    expect(isEditablePlatform("profile")).toBe(false);
  });
});
