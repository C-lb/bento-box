import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { drive_v3 } from "googleapis";
import { getToken, saveToken, type TokenInput } from "@event-editor/core/tokens";
import { openDb } from "@event-editor/core/db";
import { publicUrl } from "../paths";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? `${publicUrl()}/api/google/callback`,
  );
}

export function buildAuthUrl(client: OAuth2Client): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE, DRIVE_FILE_SCOPE, SHEETS_SCOPE],
  });
}

export async function exchangeCode(client: OAuth2Client, code: string): Promise<TokenInput> {
  const { tokens } = await client.getToken(code);
  return {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? null,
    expiryMs: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
  };
}

export async function googleAccessToken(
  db: ReturnType<typeof openDb>,
): Promise<{ token: string; expiresAt: number | null } | null> {
  const stored = getToken(db, "google");
  if (!stored) return null;
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiryMs ?? undefined,
  });
  client.on("tokens", (t) => {
    saveToken(db, "google", {
      accessToken: t.access_token ?? stored.accessToken,
      refreshToken: t.refresh_token ?? null,
      expiryMs: t.expiry_date ?? null,
      scope: t.scope ?? null,
    });
  });
  const res = await client.getAccessToken().catch(() => null);
  if (!res?.token) return null;
  return { token: res.token, expiresAt: client.credentials.expiry_date ?? null };
}

export async function authedDriveClient(
  db: ReturnType<typeof openDb>,
): Promise<drive_v3.Drive | null> {
  const stored = getToken(db, "google");
  if (!stored) return null;
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiryMs ?? undefined,
  });
  client.on("tokens", (t) => {
    saveToken(db, "google", {
      accessToken: t.access_token ?? stored.accessToken,
      refreshToken: t.refresh_token ?? null,
      expiryMs: t.expiry_date ?? null,
      scope: t.scope ?? null,
    });
  });
  return google.drive({ version: "v3", auth: client });
}
