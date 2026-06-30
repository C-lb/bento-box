import { describe, it, expect } from "vitest";
import { createVerifier, challengeFor } from "../lib/canva/pkce";

describe("pkce", () => {
  it("matches the RFC 7636 S256 vector", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(challengeFor(v)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("verifier is url-safe and long enough", () => {
    const v = createVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]{43,128}$/);
  });
});
