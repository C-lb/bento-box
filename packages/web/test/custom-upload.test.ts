import { describe, it, expect } from "vitest";
import { assetSrc, MAX_UPLOAD_BYTES } from "../lib/custom-upload";

describe("assetSrc", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  it("images become data URLs", () => {
    expect(assetSrc("png", bytes)).toBe("data:image/png;base64,AQID");
    expect(assetSrc("jpg", bytes)).toBe("data:image/jpeg;base64,AQID");
  });
  it("pdf becomes plain base64", () => {
    expect(assetSrc("pdf", bytes)).toBe("AQID");
  });
});

describe("upload cap", () => {
  it("is 15MB", () => expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024));
});
