import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { openDb } from "./db.js";

const DDL = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_folder_id TEXT NOT NULL,
    drive_folder_name TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    drive_file_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    thumbnail_path TEXT,
    width INTEGER,
    height INTEGER,
    sharpness REAL,
    brightness REAL,
    aspect_ratio REAL,
    face_count INTEGER,
    stage TEXT NOT NULL DEFAULT 'pending',
    reject_reason TEXT,
    error_message TEXT,
    score INTEGER,
    reasons TEXT,
    rank INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS headshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_photo_id INTEGER REFERENCES photos(id),
    source_upload_path TEXT,
    canva_template_id TEXT NOT NULL,
    name_text TEXT,
    title_text TEXT,
    autofill_job_id TEXT,
    design_id TEXT,
    status TEXT NOT NULL DEFAULT 'autofilling',
    export_url TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
];

export function runMigrations(db: BetterSQLite3Database<any>): void {
  for (const stmt of DDL) {
    db.run(sql.raw(stmt));
  }
}

// CLI entry: `npm -w @event-editor/core run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations(openDb());
  console.log(`migrated ${getDbPathLabel()}`);
}

function getDbPathLabel(): string {
  return process.env.EE_DB_PATH ?? "./data/app.db";
}
