import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { pathToFileURL } from "node:url";
import { openDb } from "./db.js";
import { LINKEDIN_EXAMPLES, ARTICLE_EXAMPLES } from "./summary-examples.js";

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
    source_drive_file_id TEXT,
    renderer TEXT NOT NULL DEFAULT 'local',
    canva_template_id TEXT,
    template_id TEXT,
    name_text TEXT,
    title_text TEXT,
    style_json TEXT,
    autofill_job_id TEXT,
    design_id TEXT,
    status TEXT NOT NULL DEFAULT 'rendering',
    output_path TEXT,
    export_url TEXT,
    error_message TEXT,
    batch_id TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expiry_ms INTEGER,
    scope TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_filename TEXT NOT NULL,
    source_upload_path TEXT NOT NULL,
    duration_sec REAL,
    status TEXT NOT NULL DEFAULT 'uploading',
    transcript_text TEXT,
    summary_text TEXT,
    doc_id TEXT,
    doc_url TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
    ,context_file_path TEXT,
    context_text TEXT,
    event_details TEXT,
    summary_linkedin TEXT,
    summary_article TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS style_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    format TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS ranking_contexts (
    platform TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS slice_runs (
    run_id TEXT PRIMARY KEY,
    source_filename TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS heic_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    out_filename TEXT NOT NULL,
    out_format TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS tool_runs (
    id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    label TEXT NOT NULL,
    mode TEXT,
    outputs TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
];

// Legacy DBs created before 4a have a Canva-only headshots table (NOT NULL
// canva_template_id, missing renderer/template_id/output_path). CREATE TABLE
// IF NOT EXISTS skips them, so rebuild in place. Detection: the `renderer`
// column is absent. The copy is explicit (overlapping legacy columns only) so
// no rows are lost; second run finds `renderer` present and no-ops.
function migrateHeadshots(db: BetterSQLite3Database<any>): void {
  const info = db.all(sql.raw("PRAGMA table_info(headshots)")) as Array<{ name: string }>;
  const names = new Set(info.map((r) => r.name));
  // DDL runs first so the table always exists here; skip once it's on the new
  // shape (idempotent). The size===0 arm is defensive only.
  if (names.size === 0 || names.has("renderer")) return;

  db.run(sql.raw("ALTER TABLE headshots RENAME TO headshots_legacy"));
  db.run(sql.raw(`CREATE TABLE headshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_photo_id INTEGER REFERENCES photos(id),
    source_upload_path TEXT,
    source_drive_file_id TEXT,
    renderer TEXT NOT NULL DEFAULT 'local',
    canva_template_id TEXT,
    template_id TEXT,
    name_text TEXT,
    title_text TEXT,
    autofill_job_id TEXT,
    design_id TEXT,
    status TEXT NOT NULL DEFAULT 'rendering',
    output_path TEXT,
    export_url TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`));
  db.run(sql.raw(`INSERT INTO headshots
    (id, source, source_photo_id, source_upload_path, canva_template_id,
     name_text, title_text, autofill_job_id, design_id, status, export_url,
     error_message, created_at, updated_at)
    SELECT id, source, source_photo_id, source_upload_path, canva_template_id,
     name_text, title_text, autofill_job_id, design_id, status, export_url,
     error_message, created_at, updated_at
    FROM headshots_legacy`));
  db.run(sql.raw("DROP TABLE headshots_legacy"));
}

export function addColumnIfMissing(db: BetterSQLite3Database<any>, table: string, column: string, ddlType: string): void {
  const info = db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>;
  if (!info.some((r) => r.name === column)) {
    db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`));
  }
}

export function seedStyleExamples(db: BetterSQLite3Database<any>): void {
  const seed = (format: "linkedin" | "article", texts: string[]) => {
    const rows = db.all(
      sql.raw(`SELECT COUNT(*) AS n FROM style_examples WHERE format = '${format}'`),
    ) as Array<{ n: number }>;
    if ((rows[0]?.n ?? 0) > 0) return;
    let now = Date.now();
    for (const t of texts) {
      const esc = t.replace(/'/g, "''");
      db.run(sql.raw(
        `INSERT INTO style_examples (format, kind, text, created_at) VALUES ('${format}', 'seed', '${esc}', ${now})`,
      ));
      now += 1; // preserve insertion order via distinct created_at
    }
  };
  seed("linkedin", LINKEDIN_EXAMPLES);
  seed("article", ARTICLE_EXAMPLES);
}

export function runMigrations(db: BetterSQLite3Database<any>): void {
  for (const stmt of DDL) {
    db.run(sql.raw(stmt));
  }
  migrateHeadshots(db);
  addColumnIfMissing(db, "headshots", "batch_id", "TEXT");
  addColumnIfMissing(db, "headshots", "style_json", "TEXT");
  addColumnIfMissing(db, "transcriptions", "context_file_path", "TEXT");
  addColumnIfMissing(db, "transcriptions", "context_text", "TEXT");
  addColumnIfMissing(db, "transcriptions", "event_details", "TEXT");
  addColumnIfMissing(db, "transcriptions", "summary_linkedin", "TEXT");
  addColumnIfMissing(db, "transcriptions", "summary_article", "TEXT");
  addColumnIfMissing(db, "transcriptions", "transcript_segments", "TEXT");
  addColumnIfMissing(db, "jobs", "platform", "TEXT");
  seedStyleExamples(db);
}

// True when this module is the process entry point (CLI or forked), false when
// imported. Compares via pathToFileURL so percent-encoding matches import.meta.url
// on both sides. A literal `file://${process.argv[1]}` breaks when the path holds
// a space (e.g. the packaged ".../Event Editor.app/..." bundle), silently skipping
// migrations.
export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  return argv1 != null && metaUrl === pathToFileURL(argv1).href;
}

// CLI entry: `npm -w @event-editor/core run migrate` (also the desktop app's forked migrate step)
if (isMainModule(import.meta.url, process.argv[1])) {
  runMigrations(openDb());
  console.log(`migrated ${process.env.EE_DB_PATH ?? "./data/app.db"}`);
}
