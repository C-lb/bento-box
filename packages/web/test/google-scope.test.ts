import { describe, it, expect } from "vitest";
import { makeOAuthClient, buildAuthUrl, SHEETS_SCOPE } from "../lib/google/oauth";

describe("google scopes", () => {
  it("auth url requests the sheets readonly scope", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    const url = buildAuthUrl(makeOAuthClient());
    expect(SHEETS_SCOPE).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(decodeURIComponent(url)).toContain(SHEETS_SCOPE);
  });
});
