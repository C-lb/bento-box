import { describe, it, expect, afterEach } from "vitest";
import { guardUpload, UPLOAD_ROUTE_PREFIXES } from "@/lib/upload-guard";
import { makeToken, AUTH_COOKIE } from "@/lib/auth";

const SECRET = "test-secret-0123456789";

afterEach(() => {
  delete process.env.EE_AUTH_PASSCODE;
  delete process.env.EE_AUTH_SECRET;
  delete process.env.EE_AUTH_DISABLED;
});

function req(opts: { path: string; method?: string; length?: number; cookie?: string }) {
  const headers: Record<string, string> = {};
  if (opts.length !== undefined) headers["content-length"] = String(opts.length);
  if (opts.cookie) headers["cookie"] = opts.cookie;
  return new Request(`http://x${opts.path}`, { method: opts.method ?? "POST", headers });
}

describe("guardUpload", () => {
  it("lets a normal request through when auth is off and size is under the cap", async () => {
    const res = await guardUpload(req({ path: "/api/slice/convert", length: 5_000_000 }));
    expect(res).toBeNull();
  });

  it("blocks with 413 when content-length exceeds the path cap", async () => {
    // slice/convert falls under the default 100 MB cap.
    const res = await guardUpload(req({ path: "/api/slice/convert", length: 200_000_000 }));
    expect(res?.status).toBe(413);
    expect((await res!.json()).error).toMatch(/too large/i);
  });

  it("honors the larger per-class cap for video uploads", async () => {
    // video cap is 2 GB, so 200 MB must pass.
    const res = await guardUpload(req({ path: "/api/video", length: 200_000_000 }));
    expect(res).toBeNull();
  });

  it("returns 401 when auth is enabled and no valid token cookie is present", async () => {
    process.env.EE_AUTH_PASSCODE = "1234";
    process.env.EE_AUTH_SECRET = SECRET;
    const res = await guardUpload(req({ path: "/api/slice/convert", length: 1000 }));
    expect(res?.status).toBe(401);
  });

  it("passes when auth is enabled and a valid token cookie is present", async () => {
    process.env.EE_AUTH_PASSCODE = "1234";
    process.env.EE_AUTH_SECRET = SECRET;
    const now = 1_000_000;
    const token = await makeToken(SECRET, now + 60_000);
    const res = await guardUpload(
      req({ path: "/api/slice/convert", length: 1000, cookie: `${AUTH_COOKIE}=${token}; other=x` }),
      now,
    );
    expect(res).toBeNull();
  });

  it("rejects an expired token even when other cookies are present", async () => {
    process.env.EE_AUTH_PASSCODE = "1234";
    process.env.EE_AUTH_SECRET = SECRET;
    const now = 1_000_000;
    const token = await makeToken(SECRET, now - 1); // already expired
    const res = await guardUpload(
      req({ path: "/api/slice/convert", length: 1000, cookie: `foo=bar; ${AUTH_COOKIE}=${token}` }),
      now,
    );
    expect(res?.status).toBe(401);
  });

  it("keeps its route list in sync with something for the middleware to exclude", () => {
    expect(UPLOAD_ROUTE_PREFIXES).toContain("/api/slice/convert");
    expect(UPLOAD_ROUTE_PREFIXES.every((p) => p.startsWith("/api/"))).toBe(true);
  });
});
