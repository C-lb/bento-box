import { describe, it, expect } from "vitest";
import { capForPath, isPublicAsset, GB, MB } from "@/lib/limits";

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

describe("public asset exemption", () => {
  it("exempts root-level public files by extension", () => {
    expect(isPublicAsset("/icon.svg")).toBe(true);
    expect(isPublicAsset("/favicon.ico")).toBe(true);
    expect(isPublicAsset("/mediapipe/wasm/vision_wasm_internal.js")).toBe(true);
    expect(isPublicAsset("/mediapipe/selfie_segmenter.tflite")).toBe(true);
  });
  it("never exempts anything under /api, regardless of extension", () => {
    expect(isPublicAsset("/api/slice/r/file/x.png")).toBe(false);
    expect(isPublicAsset("/api/steal.css")).toBe(false);
    expect(isPublicAsset("/api/video/out.js")).toBe(false);
  });
  it("does not exempt extensionless pages", () => {
    expect(isPublicAsset("/")).toBe(false);
    expect(isPublicAsset("/video")).toBe(false);
    expect(isPublicAsset("/login")).toBe(false);
  });
});
