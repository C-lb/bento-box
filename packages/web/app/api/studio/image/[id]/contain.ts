import { resolve } from "node:path";

export function isContained(baseDir: string, candidate: string): boolean {
  const base = resolve(baseDir);
  const target = resolve(candidate);
  return target === base || target.startsWith(base + "/");
}
