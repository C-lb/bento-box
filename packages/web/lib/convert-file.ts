import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { heicToImage } from "@/lib/heic";
import { zipFiles } from "@/lib/pdf";

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

// Render every PDF page to a raster image at 2x. One page → the image;
// multiple → a zip of page-1.<ext>, page-2.<ext>, ...
export async function pdfToImages(
  input: Buffer, output: "png" | "jpg",
): Promise<{ data: Buffer; ext: string; zip: boolean }> {
  // Legacy build runs under Node without a DOM. Import lazily so the module
  // only loads server-side when a PDF is actually converted.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(input),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const ext = output === "jpg" ? "jpg" : "png";
  const pages: { name: string; data: Buffer }[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // pdfjs expects a canvas 2d context; @napi-rs/canvas is compatible.
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      const data = ext === "jpg"
        ? await canvas.encode("jpeg", LOSSY_QUALITY)
        : await canvas.encode("png");
      pages.push({ name: `page-${n}.${ext}`, data: Buffer.from(data) });
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
  }
  if (pages.length === 0) throw new Error("The PDF has no pages.");
  if (pages.length === 1) return { data: pages[0].data, ext, zip: false };
  return { data: await zipFiles(pages), ext: "zip", zip: true };
}
