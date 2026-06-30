import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { publicUrl, thumbsDir, fontPath } from "../lib/paths";

const KEYS = ["EE_PUBLIC_URL", "EE_THUMBS_DIR", "EE_FONT_PATH"] as const;
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("paths helpers", () => {
  it("publicUrl defaults to localhost:3000, honours override", () => {
    expect(publicUrl()).toBe("http://localhost:3000");
    process.env.EE_PUBLIC_URL = "http://127.0.0.1:4571";
    expect(publicUrl()).toBe("http://127.0.0.1:4571");
  });
  it("thumbsDir defaults to data/thumbs, honours override", () => {
    expect(thumbsDir()).toBe("data/thumbs");
    process.env.EE_THUMBS_DIR = "/abs/thumbs";
    expect(thumbsDir()).toBe("/abs/thumbs");
  });
  it("fontPath defaults to the cwd-relative ttf, honours override", () => {
    expect(fontPath()).toBe(resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf"));
    process.env.EE_FONT_PATH = "/abs/font.ttf";
    expect(fontPath()).toBe("/abs/font.ttf");
  });
});
