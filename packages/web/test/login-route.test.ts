import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST, _resetAttempts } from "@/app/api/auth/login/route";

function req(body: unknown, ip = "1.2.3.4") {
  return new Request("http://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("login route", () => {
  beforeEach(() => {
    process.env.EE_AUTH_PASSCODE = "6767";
    process.env.EE_AUTH_SECRET = "test-secret";
    _resetAttempts();
  });
  afterEach(() => {
    delete process.env.EE_AUTH_PASSCODE;
    delete process.env.EE_AUTH_SECRET;
  });

  it("sets the auth cookie on the right code", async () => {
    const res = await POST(req({ code: "6767" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("ee_auth=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("401s on a wrong code, no cookie", async () => {
    const res = await POST(req({ code: "0000" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("429s after 10 failures from one IP", async () => {
    for (let i = 0; i < 10; i++) await POST(req({ code: "bad" }, "9.9.9.9"));
    const res = await POST(req({ code: "6767" }, "9.9.9.9"));
    expect(res.status).toBe(429);
  });
  it("500s when auth is not configured", async () => {
    delete process.env.EE_AUTH_PASSCODE;
    const res = await POST(req({ code: "6767" }));
    expect(res.status).toBe(500);
  });
});
