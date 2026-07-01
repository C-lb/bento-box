import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  openDb,
  runMigrations,
  transcriptions,
  createTranscription,
  runTranscription,
} from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-tx-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const happyDeps = {
  prepareChunks: async () => ({ paths: ["c0", "c1"], offsets: [0, 600], durationSec: 1234 }),
  transcribeChunk: async (p: string) => ({
    segments: p === "c0" ? [{ start: 0, text: "alpha" }] : [{ start: 2, text: "beta" }],
  }),
  summarize: async () => "the summary",
  createDoc: async () => ({ id: "doc1", url: "https://docs/doc1" }),
  extractDetails: async () => ({ eventName: "Demo Event", eventDescription: "", speakers: [], sponsors: [] }),
};

describe("runTranscription", () => {
  it("transcribes, summarizes, creates a doc, and marks done", async () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "talk.mp3" });
    db.update(transcriptions).set({ sourceUploadPath: "data/uploads/x/talk.mp3" }).where(eq(transcriptions.id, id)).run();

    await runTranscription(db, id, happyDeps, { chunkSec: 600 });

    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("done");
    expect(row.durationSec).toBe(1234);
    expect(row.transcriptText).toContain("alpha");
    expect(row.transcriptText).toContain("beta");
    expect(row.summaryText).toBe("the summary");
    expect(row.docId).toBe("doc1");
    expect(row.docUrl).toBe("https://docs/doc1");

    const done = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(JSON.parse(done.eventDetails as string).eventName).toBe("Demo Event");
  });

  it("marks the row error when a step throws", async () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "bad.mp3" });
    db.update(transcriptions).set({ sourceUploadPath: "data/uploads/y/bad.mp3" }).where(eq(transcriptions.id, id)).run();

    await runTranscription(
      db,
      id,
      { ...happyDeps, transcribeChunk: async () => { throw new Error("groq down"); } },
      { chunkSec: 600 },
    );

    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toMatch(/groq down/);
  });

  it("still creates the doc and marks done when extraction fails", async () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "extract-fail.mp3" });
    db.update(transcriptions).set({ sourceUploadPath: "data/uploads/z/extract-fail.mp3" }).where(eq(transcriptions.id, id)).run();

    await runTranscription(
      db,
      id,
      { ...happyDeps, extractDetails: async () => { throw new Error("refused"); } },
      { chunkSec: 600 },
    );

    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("done");
    expect(row.docId).toBe("doc1");
    expect(row.docUrl).toBe("https://docs/doc1");
    expect(JSON.parse(row.eventDetails as string).eventName).toBe("");
  });
});
