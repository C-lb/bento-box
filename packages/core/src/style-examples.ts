import { and, asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { styleExamples } from "./schema/index.js";

export type Format = "linkedin" | "article";
export type ExampleItem = { id: number; text: string };

const LIKED_PROMPT_CAP = 3;

type DB = BetterSQLite3Database<any>;

function rowsByKind(db: DB, format: Format, kind: string, order: "asc" | "desc") {
  // Tiebreak on id: createdAt is millisecond-resolution and can collide
  // across rapid inserts (e.g. seeding, tight loops), which would otherwise
  // leave ties in ascending row order even when "desc" (newest-first) is requested.
  const [primary, secondary] =
    order === "asc"
      ? [asc(styleExamples.createdAt), asc(styleExamples.id)]
      : [desc(styleExamples.createdAt), desc(styleExamples.id)];
  return db
    .select()
    .from(styleExamples)
    .where(and(eq(styleExamples.format, format), eq(styleExamples.kind, kind)))
    .orderBy(primary, secondary)
    .all()
    .map((r) => ({ id: r.id, text: r.text }));
}

export function listExamples(db: DB, format: Format) {
  return {
    seed: rowsByKind(db, format, "seed", "asc"),
    custom: rowsByKind(db, format, "custom", "asc"),
    liked: rowsByKind(db, format, "liked", "desc"),
  };
}

export function promptExamples(db: DB, format: Format): string[] {
  const seed = rowsByKind(db, format, "seed", "asc");
  const custom = rowsByKind(db, format, "custom", "asc");
  const liked = rowsByKind(db, format, "liked", "desc").slice(0, LIKED_PROMPT_CAP);
  return [...seed, ...custom, ...liked].map((r) => r.text);
}

export function addExample(db: DB, format: Format, kind: "custom" | "liked", text: string): ExampleItem {
  const res = db
    .insert(styleExamples)
    .values({ format, kind, text, createdAt: Date.now() })
    .run();
  return { id: Number(res.lastInsertRowid), text };
}

export function updateExample(db: DB, id: number, text: string): void {
  db.update(styleExamples).set({ text }).where(eq(styleExamples.id, id)).run();
}

export function deleteExample(db: DB, id: number): void {
  db.delete(styleExamples).where(eq(styleExamples.id, id)).run();
}

export function isLiked(db: DB, format: Format, text: string): boolean {
  const hit = db
    .select()
    .from(styleExamples)
    .where(and(eq(styleExamples.format, format), eq(styleExamples.kind, "liked"), eq(styleExamples.text, text)))
    .all();
  return hit.length > 0;
}

export function toggleLiked(db: DB, format: Format, text: string): { liked: boolean } {
  const existing = db
    .select()
    .from(styleExamples)
    .where(and(eq(styleExamples.format, format), eq(styleExamples.kind, "liked"), eq(styleExamples.text, text)))
    .all();
  if (existing.length > 0) {
    for (const row of existing) db.delete(styleExamples).where(eq(styleExamples.id, row.id)).run();
    return { liked: false };
  }
  addExample(db, format, "liked", text);
  return { liked: true };
}
