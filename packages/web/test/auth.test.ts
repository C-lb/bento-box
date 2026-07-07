import { describe, it, expect } from "vitest";
import { makeToken, verifyToken, authEnabled } from "@/lib/auth";

const SECRET = "test-secret";

describe("auth tokens", () => {
  it("round-trips a valid token", async () => {
    const t = await makeToken(SECRET, Date.now() + 60_000);
    expect(await verifyToken(SECRET, t, Date.now())).toBe(true);
  });
  it("rejects expired tokens", async () => {
    const t = await makeToken(SECRET, Date.now() - 1);
    expect(await verifyToken(SECRET, t, Date.now())).toBe(false);
  });
  it("rejects tampered payloads and wrong secrets", async () => {
    const t = await makeToken(SECRET, Date.now() + 60_000);
    const [exp, sig] = t.split(".");
    expect(await verifyToken(SECRET, `${Number(exp) + 9999}.${sig}`, Date.now())).toBe(false);
    expect(await verifyToken("other", t, Date.now())).toBe(false);
  });
  it("rejects missing/malformed tokens", async () => {
    expect(await verifyToken(SECRET, undefined, Date.now())).toBe(false);
    expect(await verifyToken(SECRET, "garbage", Date.now())).toBe(false);
  });
  it("authEnabled requires passcode+secret and honours the kill switch", () => {
    expect(authEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(authEnabled({ EE_AUTH_PASSCODE: "1", EE_AUTH_SECRET: "s" } as NodeJS.ProcessEnv)).toBe(true);
    expect(authEnabled({ EE_AUTH_PASSCODE: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(authEnabled({ EE_AUTH_PASSCODE: "1", EE_AUTH_SECRET: "s", EE_AUTH_DISABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
