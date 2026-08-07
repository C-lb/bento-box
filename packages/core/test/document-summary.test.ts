import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  openDb, runMigrations, transcriptions, createTranscription, runDocumentSummary,
} from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-docsum-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const happyDeps = {
  summarize: async () => "the summary",
  extractDetails: async () => ({ eventName: "", eventDescription: "", speakers: [], sponsors: [] }),
  writeDoc: async () => ({ id: "doc1", url: "https://docs/doc1" }),
};

function seed(db: any, over: Record<string, unknown>) {
  const id = createTranscription(db, { originalFilename: "report.pdf" });
  db.update(transcriptions)
    .set({ sourceKind: "document", transcriptText: "the document body", ...over })
    .where(eq(transcriptions.id, id)).run();
  return id;
}

describe("runDocumentSummary", () => {
  it("summarizes, writes a doc, and marks done", async () => {
    const db = freshDb();
    const id = seed(db, {});
    await runDocumentSummary(db, id, happyDeps);
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("done");
    expect(row.summaryText).toBe("the summary");
    expect(row.docId).toBe("doc1");
    expect(row.docUrl).toBe("https://docs/doc1");
  });

  it("passes a Source document section for a dragged file", async () => {
    const db = freshDb();
    const id = seed(db, {});
    let seen: string[] = [];
    await runDocumentSummary(db, id, {
      ...happyDeps,
      writeDoc: async (sections) => { seen = sections.map((s) => s.heading); return { id: "d", url: "u" }; },
    });
    expect(seen).toEqual(["Summary", "Source document"]);
  });

  it("passes no source section for a gdoc, and stores the tab id", async () => {
    const db = freshDb();
    const id = seed(db, { sourceKind: "gdoc", sourceDocId: "srcdoc" });
    let seen: string[] = [];
    await runDocumentSummary(db, id, {
      ...happyDeps,
      writeDoc: async (sections) => { seen = sections.map((s) => s.heading); return { id: "srcdoc", url: "u", tabId: "t.9" }; },
    });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(seen).toEqual(["Summary"]);
    expect(row.docTabId).toBe("t.9");
  });

  it("records the error message and stops on failure", async () => {
    const db = freshDb();
    const id = seed(db, {});
    await runDocumentSummary(db, id, {
      ...happyDeps,
      summarize: async () => { throw new Error("model exploded"); },
    });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toBe("model exploded");
  });

  it("survives a details-extraction failure", async () => {
    const db = freshDb();
    const id = seed(db, {});
    await runDocumentSummary(db, id, {
      ...happyDeps,
      extractDetails: async () => { throw new Error("nope"); },
    });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("done");
  });
});
