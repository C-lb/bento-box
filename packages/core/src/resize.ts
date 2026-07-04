import { swapExt } from "./names.js";

export type ResizeFormat = "keep" | "jpg" | "png" | "webp";
type SharpFmt = "jpeg" | "png" | "webp";

function posIntOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

export function normalizeResizeOpts(raw: {
  maxW?: unknown; maxH?: unknown; format?: string; quality?: unknown;
}): { maxW: number | null; maxH: number | null; format: ResizeFormat; quality: number } {
  const format: ResizeFormat =
    raw.format === "jpg" || raw.format === "png" || raw.format === "webp" ? raw.format : "keep";
  const q = Number.isFinite(Number(raw.quality)) ? Math.round(Number(raw.quality)) : 80;
  return {
    maxW: posIntOrNull(raw.maxW),
    maxH: posIntOrNull(raw.maxH),
    format,
    quality: Math.min(100, Math.max(1, q)),
  };
}

export function sharpFormat(format: ResizeFormat, srcName: string): SharpFmt {
  if (format === "jpg") return "jpeg";
  if (format === "png") return "png";
  if (format === "webp") return "webp";
  const ext = (srcName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  return "jpeg";
}

export function resizeOutName(srcName: string, format: ResizeFormat, srcExt: string): string {
  const ext = format === "keep" ? (srcExt || "jpg").toLowerCase() : format;
  return swapExt(srcName, ext === "jpeg" ? "jpg" : ext);
}
