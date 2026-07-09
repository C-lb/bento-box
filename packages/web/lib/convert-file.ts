import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { heicToImage } from "@/lib/heic";

const LOSSY_QUALITY = 82;

// Raster image → png/jpg/webp. No resize (the resize tool owns that).
export async function imageToRaster(input: Buffer, output: "png" | "jpg" | "webp"): Promise<Buffer> {
  const img = sharp(input, { failOn: "none" });
  if (output === "png") return img.png().toBuffer();
  if (output === "webp") return img.webp({ quality: LOSSY_QUALITY }).toBuffer();
  return img.jpeg({ quality: LOSSY_QUALITY }).toBuffer();
}

// heic/heif → png/jpg via heic-convert (heicToImage returns png/jpeg bytes).
// heicToImage takes `format` as lowercase "png" | "jpg" (matches our `output`
// param directly) and `quality` on a 0-100 scale (it divides by 100 itself
// before calling heic-convert) — NOT "PNG"/"JPEG" or a pre-divided 0..1 value.
export async function heicToRaster(input: Buffer, output: "png" | "jpg"): Promise<Buffer> {
  return heicToImage(input, { format: output, quality: LOSSY_QUALITY });
}

// png/jpeg bytes → one-page PDF sized exactly to the image.
export async function imageToPdf(input: Buffer, srcName: string): Promise<Buffer> {
  // Normalize to PNG so embedPng always works (input may be jpg/webp/etc).
  const png = await sharp(input, { failOn: "none" }).png().toBuffer();
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return Buffer.from(await doc.save());
}
