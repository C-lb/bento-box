import type { TokenInput } from "@event-editor/core/tokens";

export const CANVA_REDIRECT = "http://127.0.0.1:3000/api/canva/callback";
export const CANVA_SCOPES = [
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "asset:write",
  "design:content:write",
  "design:meta:read",
  "design:content:read",
];
const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

export class CanvaError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function basicAuth(): string {
  const id = process.env.CANVA_CLIENT_ID ?? "";
  const secret = process.env.CANVA_CLIENT_SECRET ?? "";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function buildAuthUrl(state: string, challenge: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.CANVA_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", CANVA_REDIRECT);
  u.searchParams.set("scope", CANVA_SCOPES.join(" "));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(form: Record<string, string>): Promise<TokenInput> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new CanvaError(`canva token ${res.status}`, res.status);
  }
  const j: any = await res.json();
  return {
    accessToken: j.access_token ?? "",
    refreshToken: j.refresh_token ?? null,
    expiryMs: j.expires_in ? Date.now() + j.expires_in * 1000 : null,
    scope: j.scope ?? null,
  };
}

export function exchangeCode(code: string, verifier: string): Promise<TokenInput> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: CANVA_REDIRECT,
  });
}

export function refreshToken(refresh: string): Promise<TokenInput> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
}
