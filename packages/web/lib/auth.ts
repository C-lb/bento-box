export const AUTH_COOKIE = "ee_auth";
export const AUTH_MAX_AGE_S = 90 * 24 * 3600;

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeToken(secret: string, expiresAtMs: number): Promise<string> {
  const payload = String(expiresAtMs);
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyToken(
  secret: string,
  token: string | undefined,
  nowMs: number,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = await hmacHex(secret, payload);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  const exp = Number(payload);
  return diff === 0 && Number.isFinite(exp) && exp > nowMs;
}

export function authEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.EE_AUTH_PASSCODE && !!env.EE_AUTH_SECRET && env.EE_AUTH_DISABLED !== "1";
}
