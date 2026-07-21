import { copyFile, mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { transcriptions } from "@event-editor/core/schema";
import { createTranscription } from "@event-editor/core/transcription";
import { getDb } from "@/lib/db";
import { startTranscription } from "@/lib/transcriber";
import { dataRoot } from "@/lib/jobs";
import { pollUntilTerminal } from "./poll";
import type { StepAdapter } from "../types";
import type { FileRef } from "../StepIO";

export interface TranscribeOutput {
  transcriptionId: number;
  docUrl: string | null;
  summaryText: string | null;
}

export const transcribeStep: StepAdapter<FileRef, Record<string, never>, TranscribeOutput> = {
  inputKind: "file",
  outputKind: "doc",
  paramsSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(input) {
    const db = getDb();
    const id = createTranscription(db, { originalFilename: input.filename });
    const dir = resolve(dataRoot(), "uploads", String(id));
    await mkdir(dir, { recursive: true });
    const uploadPath = resolve(dir, input.filename);
    await copyFile(input.path, uploadPath);
    db.update(transcriptions)
      .set({ sourceUploadPath: uploadPath, updatedAt: Date.now() })
      .where(eq(transcriptions.id, id))
      .run();

    startTranscription(db, id);
    const row = await pollUntilTerminal(
      () => db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0],
      (r) => r.status === "done" || r.status === "error",
      { timeoutMs: 20 * 60 * 1000 },
    );
    if (row.status === "error") throw new Error(row.errorMessage ?? "Transcription failed.");
    return { transcriptionId: id, docUrl: row.docUrl, summaryText: row.summaryText };
  },
};
