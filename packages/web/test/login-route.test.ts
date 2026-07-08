import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST, _resetAttempts } from "@/app/api/auth/login/route";

function req(body: unknown, ip = "1.2.3.4", extraHeaders: Record<string, string> = {}) {
  return new Request("http://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...extraHeaders },
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

  it("keys on cf-connecting-ip, not a spoofed x-forwarded-for", async () => {
    // Same real client IP via cf-connecting-ip on every request, but a fresh
    // (attacker-controlled) x-forwarded-for each time. If the limiter still
    // trusted XFF this would never trip.
    for (let i = 0; i < 10; i++) {
      await POST(req({ code: "bad" }, `10.0.0.${i}`, { "cf-connecting-ip": "5.5.5.5" }));
    }
    const blocked = await POST(
      req({ code: "6767" }, "10.0.0.99", { "cf-connecting-ip": "5.5.5.5" }),
    );
    expect(blocked.status).toBe(429);

    // A different real client (different cf-connecting-ip) is unaffected.
    const other = await POST(req({ code: "6767" }, "10.0.0.100", { "cf-connecting-ip": "6.6.6.6" }));
    expect(other.status).toBe(200);
  });

  it("trips a global cap once total failures across all IPs exceed the window budget", async () => {
    // 100 failures spread across distinct IPs — none individually hits the
    // per-IP cap of 10, but the shared passcode brute-force budget is spent.
    for (let i = 0; i < 100; i++) {
      await POST(req({ code: "bad" }, undefined, { "cf-connecting-ip": `1.1.1.${i}` }));
    }
    const res = await POST(req({ code: "6767" }, undefined, { "cf-connecting-ip": "2.2.2.2" }));
    expect(res.status).toBe(429);
  });
});
