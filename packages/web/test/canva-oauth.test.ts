import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUrl, exchangeCode } from "../lib/canva/oauth";

beforeEach(() => {
  process.env.CANVA_CLIENT_ID = "cid";
  process.env.CANVA_CLIENT_SECRET = "secret";
});

describe("canva oauth", () => {
  it("builds an authorize url with PKCE + fixed 127.0.0.1 redirect", () => {
    const url = new URL(buildAuthUrl("st8", "chal"));
    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("state")).toBe("st8");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/api/canva/callback");
    expect(url.searchParams.get("client_id")).toBe("cid");
  });

  it("exchanges a code into a TokenInput", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "asset:write" }),
    }));
    vi.stubGlobal("fetch", fetchMock as any);
    const tok = await exchangeCode("code123", "verifier123");
    expect(tok.accessToken).toBe("at");
    expect(tok.refreshToken).toBe("rt");
    expect(typeof tok.expiryMs).toBe("number");
    const [, init] = fetchMock.mock.calls[0];
    expect(String((init as any).body)).toContain("code_verifier=verifier123");
  });
});
