import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, transcriptions, createTranscription } from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-doccols-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

describe("document source columns", () => {
  it("defaults to null on a new row so old rows read as audio", () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "talk.mp3" });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.sourceKind).toBeNull();
    expect(row.sourceDocId).toBeNull();
    expect(row.docTabId).toBeNull();
  });

  it("round-trips a gdoc row", () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "board pack" });
    db.update(transcriptions)
      .set({ sourceKind: "gdoc", sourceDocId: "doc123", docTabId: "t.abc" })
      .where(eq(transcriptions.id, id))
      .run();
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.sourceKind).toBe("gdoc");
    expect(row.sourceDocId).toBe("doc123");
    expect(row.docTabId).toBe("t.abc");
  });
});
