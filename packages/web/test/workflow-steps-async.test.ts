import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, jobs, transcriptions, headshots } from "@event-editor/core";

import { pollUntilTerminal } from "../lib/workflow/steps/poll.js";

describe("pollUntilTerminal", () => {
  it("resolves once isTerminal is true", async () => {
    let calls = 0;
    const rows = [{ status: "running" }, { status: "running" }, { status: "done" }];
    const result = await pollUntilTerminal(
      () => rows[Math.min(calls++, rows.length - 1)],
      (r) => r.status === "done",
      { intervalMs: 1 },
    );
    expect(result.status).toBe("done");
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("throws on timeout if never terminal", async () => {
    await expect(
      pollUntilTerminal(() => ({ status: "running" }), (r) => r.status === "done", { intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow(/timed out/i);
  });

  it("throws if read() returns undefined (row missing)", async () => {
    await expect(
      pollUntilTerminal(() => undefined, () => true, { intervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow(/not found/i);
  });
});

function freshDb() {
  const path = join(tmpdir(), `ee-async-steps-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

// A mutable holder so each test can point getDb() at its own fresh sqlite db.
vi.mock("@/lib/db", () => {
  const state: { db: unknown } = { db: null };
  return {
    getDb: () => state.db,
    __setDb: (db: unknown) => {
      state.db = db;
    },
  };
});

async function useDb(db: unknown) {
  const dbMod: any = await import("@/lib/db");
  dbMod.__setDb(db);
}

// --- sorterStep -------------------------------------------------------

vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: vi.fn(async () => ({})),
}));
vi.mock("@/lib/google/drive", () => ({
  makeDriveClient: vi.fn(() => ({
    listImages: async () => [],
    listImagesDeep: async () => [],
    downloadThumbnail: async () => null,
  })),
}));

describe("sorterStep adapter", () => {
  it("kicks off startScan, polls the jobs row to done, and returns the jobId", async () => {
    process.env.ANTHROPIC_API_KEY ??= "test-key";
    const { sorterStep } = await import("../lib/workflow/steps/sorter.js");
    const db = freshDb();
    await useDb(db);

    const out = await sorterStep.run(
      { folderId: "f1", folderName: "Folder", platform: "linkedin" },
      { includeSubfolders: false },
    );

    expect(typeof out.jobId).toBe("number");
    const row = db.select().from(jobs).where(eq(jobs.id, out.jobId)).all()[0];
    expect(row.status).toBe("done");
  });

  it("declares none -> drive-ranked-list kinds", async () => {
    const { sorterStep } = await import("../lib/workflow/steps/sorter.js");
    expect(sorterStep.inputKind).toBe("none");
    expect(sorterStep.outputKind).toBe("drive-ranked-list");
  });

  it("throws when Google isn't connected", async () => {
    const { sorterStep } = await import("../lib/workflow/steps/sorter.js");
    const db = freshDb();
    await useDb(db);
    const oauth: any = await import("@/lib/google/oauth");
    oauth.authedDriveClient.mockResolvedValueOnce(null);

    await expect(
      sorterStep.run({ folderId: "f1", folderName: "Folder", platform: "linkedin" }, {}),
    ).rejects.toThrow(/not connected/i);
  });

  it("rejects with the job row's errorMessage when the job ends in status 'error'", async () => {
    // Drive the job into a real terminal error via startScan's own preflight:
    // with an empty Drive folder ingest completes fine, but startScan fails
    // the job when ANTHROPIC_API_KEY is unset, setting a real errorMessage.
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { sorterStep } = await import("../lib/workflow/steps/sorter.js");
      const db = freshDb();
      await useDb(db);

      await expect(
        sorterStep.run({ folderId: "f1", folderName: "Folder", platform: "linkedin" }, { includeSubfolders: false }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
    } finally {
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});

// --- transcribeStep -----------------------------------------------------

vi.mock("@/lib/transcriber", () => ({
  startTranscription: vi.fn((db: any, id: number) => {
    db.update(transcriptions)
      .set({ status: "done", docUrl: "https://docs.example/doc", summaryText: "a summary", updatedAt: Date.now() })
      .where(eq(transcriptions.id, id))
      .run();
  }),
}));

describe("transcribeStep adapter", () => {
  it("creates a transcription row, copies the upload, kicks off startTranscription, and polls to done", async () => {
    const { transcribeStep } = await import("../lib/workflow/steps/transcribe.js");
    const db = freshDb();
    await useDb(db);

    const uploadDir = mkdtempSync(join(tmpdir(), "wf-transcribe-upload-"));
    const inPath = join(uploadDir, "audio.mp3");
    writeFileSync(inPath, Buffer.from("fake-audio-bytes"));
    const dataDir = mkdtempSync(join(tmpdir(), "wf-transcribe-data-"));
    process.env.EE_DATA_DIR = dataDir;

    const out = await transcribeStep.run({ path: inPath, filename: "audio.mp3" }, {});

    expect(typeof out.transcriptionId).toBe("number");
    expect(out.docUrl).toBe("https://docs.example/doc");
    expect(out.summaryText).toBe("a summary");

    delete process.env.EE_DATA_DIR;
  });

  it("declares file -> doc kinds", async () => {
    const { transcribeStep } = await import("../lib/workflow/steps/transcribe.js");
    expect(transcribeStep.inputKind).toBe("file");
    expect(transcribeStep.outputKind).toBe("doc");
  });

  it("rejects with the row's errorMessage when the transcription ends in status 'error'", async () => {
    const transcriber: any = await import("@/lib/transcriber");
    transcriber.startTranscription.mockImplementationOnce((db: any, id: number) => {
      db.update(transcriptions)
        .set({ status: "error", errorMessage: "whisper backend unreachable", updatedAt: Date.now() })
        .where(eq(transcriptions.id, id))
        .run();
    });

    const { transcribeStep } = await import("../lib/workflow/steps/transcribe.js");
    const db = freshDb();
    await useDb(db);

    const uploadDir = mkdtempSync(join(tmpdir(), "wf-transcribe-upload-err-"));
    const inPath = join(uploadDir, "audio.mp3");
    writeFileSync(inPath, Buffer.from("fake-audio-bytes"));
    const dataDir = mkdtempSync(join(tmpdir(), "wf-transcribe-data-err-"));
    process.env.EE_DATA_DIR = dataDir;

    await expect(transcribeStep.run({ path: inPath, filename: "audio.mp3" }, {})).rejects.toThrow(
      /whisper backend unreachable/,
    );

    delete process.env.EE_DATA_DIR;
  });

  it("falls back to a default message when the errored row has no errorMessage", async () => {
    const transcriber: any = await import("@/lib/transcriber");
    transcriber.startTranscription.mockImplementationOnce((db: any, id: number) => {
      db.update(transcriptions).set({ status: "error", updatedAt: Date.now() }).where(eq(transcriptions.id, id)).run();
    });

    const { transcribeStep } = await import("../lib/workflow/steps/transcribe.js");
    const db = freshDb();
    await useDb(db);

    const uploadDir = mkdtempSync(join(tmpdir(), "wf-transcribe-upload-err2-"));
    const inPath = join(uploadDir, "audio.mp3");
    writeFileSync(inPath, Buffer.from("fake-audio-bytes"));
    const dataDir = mkdtempSync(join(tmpdir(), "wf-transcribe-data-err2-"));
    process.env.EE_DATA_DIR = dataDir;

    await expect(transcribeStep.run({ path: inPath, filename: "audio.mp3" }, {})).rejects.toThrow(
      /Transcription failed\./,
    );

    delete process.env.EE_DATA_DIR;
  });
});

// --- studioStep -----------------------------------------------------

vi.mock("@/lib/batch", () => ({
  runBatch: vi.fn((db: any, _drive: any, _renderer: string, ids: number[]) => {
    for (const id of ids) {
      db.update(headshots).set({ status: "done", updatedAt: Date.now() }).where(eq(headshots.id, id)).run();
    }
  }),
}));

describe("studioStep adapter", () => {
  it("creates batch headshot rows, kicks off runBatch, and polls every row to done", async () => {
    const { studioStep } = await import("../lib/workflow/steps/studio.js");
    const db = freshDb();
    await useDb(db);

    const out = await studioStep.run(
      {
        rows: [
          { driveFileId: "d1", nameText: "Alice", titleText: "CEO" },
          { driveFileId: "d2", nameText: "Bob", titleText: "CTO" },
        ],
        styleId: "clean-band",
      },
      { renderer: "local" },
    );

    expect(out.batchId).toMatch(/^[0-9a-f]{16}$/);
    expect(out.ids).toHaveLength(2);
    for (const id of out.ids) {
      const row = db.select().from(headshots).where(eq(headshots.id, id)).all()[0];
      expect(row.status).toBe("done");
    }
  });

  it("declares none -> headshot-batch kinds", async () => {
    const { studioStep } = await import("../lib/workflow/steps/studio.js");
    expect(studioStep.inputKind).toBe("none");
    expect(studioStep.outputKind).toBe("headshot-batch");
  });

  it("throws when Google isn't connected", async () => {
    const { studioStep } = await import("../lib/workflow/steps/studio.js");
    const db = freshDb();
    await useDb(db);
    const oauth: any = await import("@/lib/google/oauth");
    oauth.authedDriveClient.mockResolvedValueOnce(null);

    await expect(
      studioStep.run({ rows: [{ driveFileId: "d1", nameText: "A", titleText: "B" }], styleId: "clean-band" }, { renderer: "local" }),
    ).rejects.toThrow(/not connected/i);
  });

  it("rejects when every headshot in the batch ends in status 'error'", async () => {
    const batch: any = await import("@/lib/batch");
    batch.runBatch.mockImplementationOnce((db: any, _drive: any, _renderer: string, ids: number[]) => {
      for (const id of ids) {
        db.update(headshots)
          .set({ status: "error", errorMessage: "render failed", updatedAt: Date.now() })
          .where(eq(headshots.id, id))
          .run();
      }
    });

    const { studioStep } = await import("../lib/workflow/steps/studio.js");
    const db = freshDb();
    await useDb(db);

    await expect(
      studioStep.run(
        {
          rows: [{ driveFileId: "d1", nameText: "Alice", titleText: "CEO" }],
          styleId: "clean-band",
        },
        { renderer: "local" },
      ),
    ).rejects.toThrow(/1 of 1 headshots failed/);
  });

  it("rejects when only a subset of the batch ends in status 'error' (partial failure)", async () => {
    const batch: any = await import("@/lib/batch");
    batch.runBatch.mockImplementationOnce((db: any, _drive: any, _renderer: string, ids: number[]) => {
      db.update(headshots).set({ status: "done", updatedAt: Date.now() }).where(eq(headshots.id, ids[0])).run();
      db.update(headshots)
        .set({ status: "error", errorMessage: "face not detected", updatedAt: Date.now() })
        .where(eq(headshots.id, ids[1]))
        .run();
    });

    const { studioStep } = await import("../lib/workflow/steps/studio.js");
    const db = freshDb();
    await useDb(db);

    await expect(
      studioStep.run(
        {
          rows: [
            { driveFileId: "d1", nameText: "Alice", titleText: "CEO" },
            { driveFileId: "d2", nameText: "Bob", titleText: "CTO" },
          ],
          styleId: "clean-band",
        },
        { renderer: "local" },
      ),
    ).rejects.toThrow(/1 of 2 headshots failed.*face not detected/s);
  });
});
