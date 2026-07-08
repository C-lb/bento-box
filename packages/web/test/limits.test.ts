import { describe, it, expect } from "vitest";
import { capForPath, GB, MB } from "@/lib/limits";

describe("upload caps", () => {
  it("gives video-class routes 2GB", () => {
    expect(capForPath("/api/video")).toBe(2 * GB);
    expect(capForPath("/api/splice")).toBe(2 * GB);
  });
  it("gives audio-class routes 500MB", () => {
    expect(capForPath("/api/convert/file")).toBe(500 * MB);
    expect(capForPath("/api/transcribe")).toBe(500 * MB);
  });
  it("gives everything else under /api 100MB", () => {
    expect(capForPath("/api/resize")).toBe(100 * MB);
    expect(capForPath("/api/pdf/process/merge")).toBe(100 * MB);
  });
  it("does not cap non-API paths or auth", () => {
    expect(capForPath("/video")).toBeNull();
    expect(capForPath("/api/auth/login")).toBeNull();
  });
});
