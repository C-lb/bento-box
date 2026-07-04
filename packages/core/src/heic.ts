import { swapExt } from "./names.js";

export type HeicFormat = "jpg" | "png";

export function normalizeHeicOpts(raw: { format?: string; quality?: number }): {
  format: HeicFormat;
  quality: number;
} {
  const format: HeicFormat = raw.format === "png" ? "png" : "jpg";
  const q = Number.isFinite(raw.quality) ? Math.round(raw.quality as number) : 82;
  const quality = Math.min(100, Math.max(1, q));
  return { format, quality };
}

export function heicOutName(srcName: string, format: HeicFormat): string {
  return swapExt(srcName, format);
}
