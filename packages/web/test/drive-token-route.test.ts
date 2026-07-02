import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { googleAccessToken } = vi.hoisted(() => ({ googleAccessToken: vi.fn() }));
vi.mock("@/lib/google/oauth", () => ({ googleAccessToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { GET } from "@/app/api/drive/token/route";

const OLD = { ...process.env };
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  process.env = { ...OLD };
});

describe("GET /api/drive/token", () => {
  it("400 when picker env is not configured", async () => {
    delete process.env.GOOGLE_PICKER_API_KEY;
    delete process.env.GOOGLE_PICKER_APP_ID;
    const res = await GET();
    expect(res.status).toBe(400);
    expect(googleAccessToken).not.toHaveBeenCalled();
  });

  it("400 when Google is not connected", async () => {
    process.env.GOOGLE_PICKER_API_KEY = "k";
    process.env.GOOGLE_PICKER_APP_ID = "123";
    googleAccessToken.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("200 with token and config when connected", async () => {
    process.env.GOOGLE_PICKER_API_KEY = "k";
    process.env.GOOGLE_PICKER_APP_ID = "123";
    googleAccessToken.mockResolvedValue({ token: "ya29.x", expiresAt: 999 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "ya29.x", expires_at: 999, apiKey: "k", appId: "123" });
  });
});
