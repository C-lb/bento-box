import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { rankingContexts } from "./schema/index.js";

export const PLATFORMS = ["instagram", "linkedin", "profile"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const EDITABLE_PLATFORMS = ["instagram", "linkedin"] as const;
export type EditablePlatform = (typeof EDITABLE_PLATFORMS)[number];

export const INSTAGRAM_DEFAULT =
  "Judge this photo as content for an aesthetic Instagram feed. It does not need a person in it. " +
  "Reward strong composition (rule of thirds, leading lines, balance, intentional negative space), " +
  "a cohesive and pleasing colour palette with rich but natural colour, flattering light (soft, golden " +
  "hour, or moody done well), a clear subject or strong sense of place with an editorial magazine-like " +
  "feel, and an overall vibe that would stop a scroll. Penalise cluttered or messy framing, muddy or " +
  "clashing colour, flat or unflattering light, harsh flash, accidental-looking blur or noise, and " +
  "generic snapshots with no point of interest.";

export const LINKEDIN_DEFAULT =
  "Judge this photo as a professional LinkedIn headshot. Reward one clearly-focused person as the " +
  "subject, natural eye contact and an approachable expression, head and shoulders framing that is " +
  "neither too far nor too tight, even flattering light with no harsh shadows or blowout, a clean " +
  "non-distracting background, and professional or smart-casual attire. Penalise casual group shots, " +
  "full-body or distant framing, no clear face, busy backgrounds, and poor lighting.";

export const PROFILE_CONTEXT =
  "Judge this photo as an all-purpose profile picture or avatar. Reward one clear well-lit face looking " +
  "toward the camera, tight head and shoulders framing that crops cleanly to a circle, a friendly " +
  "natural expression, and a simple uncluttered background. Penalise multiple people, distant or " +
  "full-body shots, obscured or side-turned faces, heavy shadows, and busy backgrounds.";

export const DEFAULT_CONTEXTS: Record<EditablePlatform, string> = {
  instagram: INSTAGRAM_DEFAULT,
  linkedin: LINKEDIN_DEFAULT,
};

export function isPlatform(v: string): v is Platform {
  return (PLATFORMS as readonly string[]).includes(v);
}

export function isEditablePlatform(v: string): v is EditablePlatform {
  return (EDITABLE_PLATFORMS as readonly string[]).includes(v);
}

export function defaultContext(platform: Platform): string {
  return platform === "profile" ? PROFILE_CONTEXT : DEFAULT_CONTEXTS[platform];
}

export function getRankingContext(db: BetterSQLite3Database<any>, platform: Platform): string {
  if (!isEditablePlatform(platform)) return defaultContext(platform);
  const row = db.select().from(rankingContexts).where(eq(rankingContexts.platform, platform)).all()[0];
  return row?.text ?? defaultContext(platform);
}

export function setRankingContext(db: BetterSQLite3Database<any>, platform: EditablePlatform, text: string): void {
  const now = Date.now();
  db.insert(rankingContexts)
    .values({ platform, text, updatedAt: now })
    .onConflictDoUpdate({ target: rankingContexts.platform, set: { text, updatedAt: now } })
    .run();
}

export function resetRankingContext(db: BetterSQLite3Database<any>, platform: EditablePlatform): void {
  db.delete(rankingContexts).where(eq(rankingContexts.platform, platform)).run();
}
