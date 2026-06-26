import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema/index.js";

export function getDbPath(path?: string): string {
  return resolve(path ?? process.env.EE_DB_PATH ?? "./data/app.db");
}

export function openDb(path?: string): BetterSQLite3Database<typeof schema> {
  const file = getDbPath(path);
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
