import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { imageToRaster, imageToPdf } from "@/lib/convert-file";

async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png().toBuffer();
}

describe("imageToRaster", () => {
  it("produces a real JPEG from a PNG", async () => {
    const out = await imageToRaster(await tinyPng(), "jpg");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
  });
  it("produces a WEBP", async () => {
    const out = await imageToRaster(await tinyPng(), "webp");
    expect((await sharp(out).metadata()).format).toBe("webp");
  });
});

describe("imageToPdf", () => {
  it("produces a valid single-page PDF", async () => {
    const out = await imageToPdf(await tinyPng());
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
  });
});
