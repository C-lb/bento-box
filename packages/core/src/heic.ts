import { swapExt } from "./names.js";

export type HeicFormat = "jpg" | "png";

export interface HeicOpts {
  format: HeicFormat;
  quality: number;
  // Filters. saturation/brightness are sharp modulate factors (1 = unchanged);
  // haze is a blur sigma (0 = none). Together they cover the common edits.
  saturation: number;
  brightness: number;
  haze: number;
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function normalizeHeicOpts(raw: {
  format?: string;
  quality?: number;
  saturation?: number;
  brightness?: number;
  haze?: number;
}): HeicOpts {
  const format: HeicFormat = raw.format === "png" ? "png" : "jpg";
  const q = Number.isFinite(raw.quality) ? Math.round(raw.quality as number) : 82;
  const quality = Math.min(100, Math.max(1, q));
  return {
    format,
    quality,
    saturation: clamp(raw.saturation, 0, 2, 1),
    brightness: clamp(raw.brightness, 0, 2, 1),
    haze: clamp(raw.haze, 0, 20, 0),
  };
}

// Whether any filter deviates from neutral (lets callers skip the sharp pass).
export function hasHeicFilters(o: HeicOpts): boolean {
  return o.saturation !== 1 || o.brightness !== 1 || o.haze > 0;
}

export function heicOutName(srcName: string, format: HeicFormat): string {
  return swapExt(srcName, format);
}
