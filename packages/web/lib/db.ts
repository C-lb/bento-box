import { openDb } from "@event-editor/core/db";

let _db: ReturnType<typeof openDb> | null = null;

export function getDb() {
  if (!_db) _db = openDb();
  return _db;
}
