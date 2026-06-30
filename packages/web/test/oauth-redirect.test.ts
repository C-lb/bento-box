import { describe, it, expect, afterEach } from "vitest";
import { makeOAuthClient } from "../lib/google/oauth";
import { canvaRedirect } from "../lib/canva/oauth";

afterEach(() => {
  delete process.env.EE_PUBLIC_URL;
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe("google redirect", () => {
  it("defaults to localhost:3000 via EE_PUBLIC_URL", () => {
    const c = makeOAuthClient() as any;
    expect(c.redirectUri).toBe("http://localhost:3000/api/google/callback");
  });
  it("follows EE_PUBLIC_URL in the bundle", () => {
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    const c = makeOAuthClient() as any;
    expect(c.redirectUri).toBe("http://127.0.0.1:4571/api/google/callback");
  });
  it("GOOGLE_REDIRECT_URI overrides everything", () => {
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    process.env.GOOGLE_REDIRECT_URI = "http://example.test/cb";
    const c = makeOAuthClient() as any;
    expect(c.redirectUri).toBe("http://example.test/cb");
  });
});

describe("canva redirect", () => {
  it("defaults to 127.0.0.1:3000 (host forced even though base is localhost)", () => {
    expect(canvaRedirect()).toBe("http://127.0.0.1:3000/api/canva/callback");
  });
  it("follows EE_PUBLIC_URL in the bundle", () => {
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    expect(canvaRedirect()).toBe("http://127.0.0.1:4571/api/canva/callback");
  });
  it("forces 127.0.0.1 even if the base uses localhost on another port", () => {
    process.env.EE_PUBLIC_URL = "http://localhost:5000";
    expect(canvaRedirect()).toBe("http://127.0.0.1:5000/api/canva/callback");
  });
});
