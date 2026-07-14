import type { Platform } from "./ranking-context.js";

export interface ImageMetrics {
  width: number;
  height: number;
  sharpness: number;
  brightness: number;
  aspectRatio: number;
}

export interface HeuristicVerdict {
  rejected: boolean;
  reason: string | null;
}

export const HEURISTICS = {
  minLongEdge: 256,
  minSharpness: 80,
  brightnessMin: 40,
  brightnessMax: 225,
  aspectMin: 0.5,
  aspectMax: 2.0,
} as const;

export const HEURISTICS_LENIENT = {
  minLongEdge: 256,
  minSharpness: 25,
  brightnessMin: 12,
  brightnessMax: 248,
  aspectMin: 0.5,
  aspectMax: 2.0,
} as const;

export function scoreHeuristics(m: ImageMetrics, platform: Platform = "linkedin"): HeuristicVerdict {
  const H = platform === "instagram" ? HEURISTICS_LENIENT : HEURISTICS;
  const longEdge = Math.max(m.width, m.height);
  // Fail open when the true size is unknown (longEdge 0): judge the photo rather
  // than reject it on a dimension we couldn't read.
  if (longEdge > 0 && longEdge < H.minLongEdge) {
    return { rejected: true, reason: `Low resolution (${m.width}x${m.height})` };
  }
  if (m.sharpness < H.minSharpness) {
    return { rejected: true, reason: "Looks blurry or out of focus" };
  }
  if (m.brightness < H.brightnessMin) {
    return { rejected: true, reason: "Too dark / underexposed" };
  }
  if (m.brightness > H.brightnessMax) {
    return { rejected: true, reason: "Too bright / blown out" };
  }
  if (m.aspectRatio < H.aspectMin || m.aspectRatio > H.aspectMax) {
    return { rejected: true, reason: "Awkward crop shape" };
  }
  return { rejected: false, reason: null };
}

export interface VisionScore {
  score: number;
  reasons: string[];
}

export function buildVisionPrompt(name: string, context: string): string {
  return [
    `You are screening one candidate photo ("${name}").`,
    context,
    `Score it from 0 to 100 on how well it fits, then give 1 to 3 short reasons (each under 12 words).`,
  ].join("\n");
}

export interface RankablePhoto {
  id: number;
  score: number | null;
  stage: string;
}

export function computeRanks(photos: RankablePhoto[]): Array<{ id: number; rank: number }> {
  return photos
    .filter((p) => p.stage === "ranked" && p.score != null)
    .sort((a, b) => (b.score! - a.score!) || (a.id - b.id))
    .map((p, i) => ({ id: p.id, rank: i + 1 }));
}
