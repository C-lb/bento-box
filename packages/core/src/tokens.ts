import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { oauthTokens } from "./schema/index.js";

export interface TokenInput {
  accessToken: string;
  refreshToken?: string | null;
  expiryMs?: number | null;
  scope?: string | null;
}

export interface StoredToken {
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiryMs: number | null;
  scope: string | null;
}

export function getToken(db: BetterSQLite3Database<any>, provider: string): StoredToken | null {
  const rows = db.select().from(oauthTokens).where(eq(oauthTokens.provider, provider)).all();
  const r = rows[0];
  if (!r) return null;
  return {
    provider: r.provider,
    accessToken: r.accessToken,
    refreshToken: r.refreshToken ?? null,
    expiryMs: r.expiryMs ?? null,
    scope: r.scope ?? null,
  };
}

export function saveToken(db: BetterSQLite3Database<any>, provider: string, token: TokenInput): void {
  const existing = getToken(db, provider);
  const refreshToken = token.refreshToken ?? existing?.refreshToken ?? null;
  const now = Date.now();
  db.insert(oauthTokens)
    .values({
      provider,
      accessToken: token.accessToken,
      refreshToken,
      expiryMs: token.expiryMs ?? null,
      scope: token.scope ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: {
        accessToken: token.accessToken,
        refreshToken,
        expiryMs: token.expiryMs ?? null,
        scope: token.scope ?? null,
        updatedAt: now,
      },
    })
    .run();
}
