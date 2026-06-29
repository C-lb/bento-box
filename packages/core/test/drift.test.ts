import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { openDb, runMigrations } from "../src/index.js";
import { jobs, photos, headshots, transcriptions } from "../src/schema/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-drift-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

function ddlColumns(db: ReturnType<typeof openDb>, table: string): Set<string> {
  const rows = db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function schemaColumns(tableObj: Parameters<typeof getTableColumns>[0]): Set<string> {
  const cols = getTableColumns(tableObj);
  return new Set(Object.values(cols).map((c) => c.name));
}

describe("schema drift guard", () => {
  it("jobs DDL matches Drizzle schema", () => {
    const db = freshDb();
    const ddl = ddlColumns(db, "jobs");
    const schema = schemaColumns(jobs);
    expect(ddl).toEqual(schema);
  });

  it("photos DDL matches Drizzle schema", () => {
    const db = freshDb();
    const ddl = ddlColumns(db, "photos");
    const schema = schemaColumns(photos);
    expect(ddl).toEqual(schema);
  });

  it("headshots DDL matches Drizzle schema", () => {
    const db = freshDb();
    const ddl = ddlColumns(db, "headshots");
    const schema = schemaColumns(headshots);
    expect(ddl).toEqual(schema);
  });

  it("transcriptions DDL matches Drizzle schema", () => {
    const db = freshDb();
    const ddl = ddlColumns(db, "transcriptions");
    const schema = schemaColumns(transcriptions);
    expect(ddl).toEqual(schema);
  });
});
