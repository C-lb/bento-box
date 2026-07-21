import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { qrStep } from "../lib/workflow/steps/qr.js";

describe("qrStep adapter", () => {
  it("declares url-text -> file kinds", () => {
    expect(qrStep.inputKind).toBe("url-text");
    expect(qrStep.outputKind).toBe("file");
  });

  it("writes a QR image file and returns a FileRef", async () => {
    const out = await qrStep.run({ text: "https://example.com" }, { size: 256, ecc: "M", fg: "#000000", bg: "#ffffff", format: "png" });
    expect(existsSync(out.path)).toBe(true);
    expect(out.filename).toMatch(/\.png$/);
  });
});
