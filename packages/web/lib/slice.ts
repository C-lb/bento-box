import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { rm, readdir, stat } from "node:fs/promises";
import { dataRoot } from "./jobs";

export function sanitizeRunId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function newRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function runDir(runId: string): string {
  // EE_DATA_DIR-aware: cwd-relative paths write inside the packaged app bundle.
  return resolve(dataRoot(), "slice", sanitizeRunId(runId));
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

export async function cleanupRun(runId: string): Promise<void> {
  await rm(runDir(runId), { recursive: true, force: true });
}

// Best-effort purge of run dirs whose last modification is older than maxAgeMs.
export async function sweepOldRuns(maxAgeMs: number): Promise<void> {
  const root = resolve(dataRoot(), "slice");
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  const now = Date.now();
  for (const name of entries) {
    const p = resolve(root, name);
    try {
      const s = await stat(p);
      if (s.isDirectory() && now - s.mtimeMs > maxAgeMs) await rm(p, { recursive: true, force: true });
    } catch { /* ignore individual failures */ }
  }
}
