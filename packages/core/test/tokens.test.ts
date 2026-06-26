import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, saveToken, getToken } from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-tok-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

describe("token store", () => {
  it("returns null when no token saved", () => {
    expect(getToken(freshDb(), "google")).toBeNull();
  });

  it("saves and reads back a token", () => {
    const db = freshDb();
    saveToken(db, "google", { accessToken: "at1", refreshToken: "rt1", expiryMs: 123, scope: "s" });
    const t = getToken(db, "google");
    expect(t).toMatchObject({ provider: "google", accessToken: "at1", refreshToken: "rt1", expiryMs: 123 });
  });

  it("upserts and preserves an existing refresh token when omitted", () => {
    const db = freshDb();
    saveToken(db, "google", { accessToken: "at1", refreshToken: "rt1" });
    saveToken(db, "google", { accessToken: "at2" }); // refresh-less refresh
    const t = getToken(db, "google");
    expect(t?.accessToken).toBe("at2");
    expect(t?.refreshToken).toBe("rt1");
  });
});
