import { describe, it, expect } from "vitest";
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
