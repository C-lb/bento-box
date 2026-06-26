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

export function scoreHeuristics(m: ImageMetrics): HeuristicVerdict {
  const longEdge = Math.max(m.width, m.height);
  if (longEdge < HEURISTICS.minLongEdge) {
    return { rejected: true, reason: `Low resolution (${m.width}x${m.height})` };
  }
  if (m.sharpness < HEURISTICS.minSharpness) {
    return { rejected: true, reason: "Looks blurry or out of focus" };
  }
  if (m.brightness < HEURISTICS.brightnessMin) {
    return { rejected: true, reason: "Too dark / underexposed" };
  }
  if (m.brightness > HEURISTICS.brightnessMax) {
    return { rejected: true, reason: "Too bright / blown out" };
  }
  if (m.aspectRatio < HEURISTICS.aspectMin || m.aspectRatio > HEURISTICS.aspectMax) {
    return { rejected: true, reason: "Awkward aspect ratio for a headshot crop" };
  }
  return { rejected: false, reason: null };
}

export interface VisionScore {
  score: number;
  reasons: string[];
}

export function buildVisionPrompt(name: string): string {
  return [
    `You are screening one candidate photo ("${name}") for use as a LinkedIn profile headshot.`,
    `Score it from 0 to 100 on overall fitness as a professional headshot, weighing:`,
    `- face clarity and whether exactly one person is clearly the subject`,
    `- eye contact and a natural, approachable expression`,
    `- framing (head and shoulders, not too far or too tight)`,
    `- lighting (even, no harsh shadows or blowout)`,
    `- background (clean and non-distracting)`,
    `- attire (professional or smart-casual)`,
    `Give 1 to 3 short reasons (each under 12 words) explaining the score.`,
    `A casual group photo, a full-body shot, or no clear face should score low.`,
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
