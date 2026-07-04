import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { rm, readdir, stat } from "node:fs/promises";

export function dataRoot(): string {
  return process.env.EE_DATA_DIR ?? "data";
}
export function sanitizeJobId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}
export function newJobId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}
export function jobDir(tool: string, id: string): string {
  return resolve(dataRoot(), tool, sanitizeJobId(id));
}
export async function cleanupJob(tool: string, id: string): Promise<void> {
  await rm(jobDir(tool, id), { recursive: true, force: true });
}
export async function sweepOldJobs(tool: string, maxAgeMs: number): Promise<void> {
  const root = resolve(dataRoot(), tool);
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  const now = Date.now();
  for (const name of entries) {
    const p = resolve(root, name);
    try {
      const s = await stat(p);
      if (s.isDirectory() && now - s.mtimeMs > maxAgeMs) {
        await rm(p, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }
}
