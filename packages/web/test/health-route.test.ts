import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("reports ok with dependency statuses", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.deps)).toBe(true);
    const ids = body.deps.map((d: { id: string }) => d.id);
    expect(ids).toContain("ffmpeg");
    expect(ids).toContain("ytdlp");
    expect(ids).toContain("libreoffice");
  });
});

describe("GET /api/health", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns a keys entry per connection with correct configured flags", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.keys)).toBe(true);
    const groq = body.keys.find((k: { id: string }) => k.id === "groq");
    const anthropic = body.keys.find((k: { id: string }) => k.id === "anthropic");
    expect(groq.configured).toBe(true);
    expect(anthropic.configured).toBe(false);
    expect(Array.isArray(body.deps)).toBe(true);
  }, 30000);
});
