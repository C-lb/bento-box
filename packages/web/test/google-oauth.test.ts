import { describe, it, expect, vi } from "vitest";

vi.mock("googleapis", () => {
  return {
    google: {
      auth: {
        OAuth2: class {
          generateAuthUrl(opts: any) {
            return "https://accounts.google.com/o/oauth2/v2/auth?scope=" + opts.scope.join(",") +
              "&access_type=" + opts.access_type + "&prompt=" + opts.prompt;
          }
          async getToken(code: string) {
            return { tokens: { access_token: "at-" + code, refresh_token: "rt", expiry_date: 999, scope: "s" } };
          }
        },
      },
    },
  };
});

const { makeOAuthClient, buildAuthUrl, exchangeCode, DRIVE_SCOPE } = await import("../lib/google/oauth.js");

describe("google oauth helpers", () => {
  it("builds an offline consent auth url with the drive scope", () => {
    const url = buildAuthUrl(makeOAuthClient());
    expect(url).toContain(encodeURI(DRIVE_SCOPE).replace(/:/g, ":")); // scope present
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
  });

  it("maps an exchanged code to our token shape", async () => {
    const t = await exchangeCode(makeOAuthClient(), "abc");
    expect(t).toEqual({ accessToken: "at-abc", refreshToken: "rt", expiryMs: 999, scope: "s" });
  });
});
