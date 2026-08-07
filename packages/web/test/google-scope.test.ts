import { describe, it, expect } from "vitest";
import { makeOAuthClient, buildAuthUrl, SHEETS_SCOPE, DOCS_SCOPE } from "../lib/google/oauth";

describe("google scopes", () => {
  it("auth url requests the sheets readonly scope", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    const url = buildAuthUrl(makeOAuthClient());
    expect(SHEETS_SCOPE).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(decodeURIComponent(url)).toContain(SHEETS_SCOPE);
  });

  // Dropping DOCS_SCOPE from buildAuthUrl 403s every tab write, and every
  // reconnect would silently mint a token that still cannot write.
  it("auth url requests the documents scope, so tab writes are authorised", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    const url = buildAuthUrl(makeOAuthClient());
    expect(DOCS_SCOPE).toBe("https://www.googleapis.com/auth/documents");
    expect(decodeURIComponent(url)).toContain(DOCS_SCOPE);
  });
});
