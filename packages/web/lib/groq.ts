import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ChunkResult } from "@event-editor/core/transcribe";

export const TRANSCRIBE_MODEL = process.env.EE_TRANSCRIBE_MODEL ?? "whisper-large-v3-turbo";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function transcribeChunk(path: string): Promise<ChunkResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const bytes = await readFile(path);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(path));
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: any = new Error(`groq transcription failed: ${res.status} ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data: any = await res.json();
  const segments = (data.segments ?? []).map((s: any) => ({
    start: Number(s.start) || 0,
    text: String(s.text ?? ""),
  }));
  return { segments };
}
