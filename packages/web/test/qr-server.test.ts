import { describe, it, expect } from "vitest";
import { generateQrBuffer } from "../lib/qr-server.js";

describe("generateQrBuffer", () => {
  it("produces a PNG buffer for text input", async () => {
    const buf = await generateQrBuffer("https://example.com", { size: 256, ecc: "M", fg: "#000000", bg: "#ffffff", format: "png" });
    expect(Buffer.isBuffer(buf)).toBe(true);
    // PNG magic bytes
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("produces an SVG buffer for text input", async () => {
    const buf = await generateQrBuffer("https://example.com", { size: 256, ecc: "M", fg: "#000000", bg: "#ffffff", format: "svg" });
    expect(buf.toString("utf8")).toContain("<svg");
  });
});
