import { resolve, dirname } from "node:path";
import { eq } from "drizzle-orm";
import { runTranscription } from "@event-editor/core/transcription";
import { planChunks } from "@event-editor/core/transcribe";
import { transcriptions } from "@event-editor/core/schema";
import type { openDb } from "@event-editor/core/db";
import { transcodeAndSegment, probeDuration } from "./audio";
import { transcribeChunk } from "./groq";
import { visionClient, summarizeTranscript } from "./anthropic";
import { authedDriveClient } from "./google/oauth";
import { createGoogleDoc } from "./google/docs";

type Db = ReturnType<typeof openDb>;

async function withBackoff<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.statusCode;
      if (status !== 429 && status !== 529) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

function fail(db: Db, id: number, message: string) {
  db.update(transcriptions)
    .set({ status: "error", errorMessage: message, updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();
}

export function startTranscription(db: Db, id: number): void {
  // Preflight keys synchronously: missing-key throws would otherwise land
  // outside runTranscription's try/catch and strand the row.
  if (!process.env.GROQ_API_KEY) return fail(db, id, "GROQ_API_KEY is not set");
  if (!process.env.ANTHROPIC_API_KEY) return fail(db, id, "ANTHROPIC_API_KEY is not set");

  const client = visionClient();

  void runTranscription(db, id, {
    prepareChunks: async (sourcePath, chunkSec) => {
      const durationSec = await probeDuration(resolve(sourcePath));
      const outDir = resolve(dirname(resolve(sourcePath)), "chunks");
      const paths = await transcodeAndSegment(resolve(sourcePath), outDir, chunkSec);
      const offsets = planChunks(durationSec, chunkSec).map((c) => c.startSec);
      while (offsets.length < paths.length) offsets.push(offsets.length * chunkSec);
      return { paths, offsets: offsets.slice(0, paths.length), durationSec };
    },
    transcribeChunk: (path) => withBackoff(() => transcribeChunk(path)),
    summarize: (transcript) => withBackoff(() => summarizeTranscript(client, transcript)),
    createDoc: async (html, name) => {
      const drive = await authedDriveClient(db);
      if (!drive) throw new Error("Google is not connected. Re-auth on /settings.");
      return createGoogleDoc(drive, html, name);
    },
  });
}
