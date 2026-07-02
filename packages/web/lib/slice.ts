import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

export function sanitizeRunId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function newRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function runDir(runId: string): string {
  return resolve("data/slice", sanitizeRunId(runId));
}

export function deckPath(runId: string): string {
  return resolve(runDir(runId), "deck.pptx");
}

export function masterPdfPath(runId: string): string {
  return resolve(runDir(runId), "deck.pdf");
}

export function outDir(runId: string): string {
  return resolve(runDir(runId), "out");
}
