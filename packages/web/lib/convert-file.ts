import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { heicToImage } from "@/lib/heic";
import { normalizeHeicOpts } from "@event-editor/core/heic";
import { zipFiles } from "@/lib/pdf";
import { convertDir, transcodeAudio } from "@/lib/convert";
import {
  categoryForFile, isAudioOutput, extFor, type OutputFormat,
} from "@event-editor/core/convert-formats";

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
  return heicToImage(input, normalizeHeicOpts({ format: output, quality: LOSSY_QUALITY }));
}

// png/jpeg bytes → one-page PDF sized exactly to the image.
export async function imageToPdf(input: Buffer): Promise<Buffer> {
  // Normalize to PNG so embedPng always works (input may be jpg/webp/etc).
  const png = await sharp(input, { failOn: "none" }).png().toBuffer();
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return Buffer.from(await doc.save());
}

// Render every PDF page to a raster PNG at the given scale (default 2x).
export async function renderPdfPages(input: Buffer, scale = 2): Promise<Buffer[]> {
  // Legacy build runs under Node without a DOM. Import lazily so the module
  // only loads server-side when a PDF is actually converted.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(input),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const pages: Buffer[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // pdfjs expects a canvas 2d context; @napi-rs/canvas is compatible.
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      pages.push(Buffer.from(await canvas.encode("png")));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  if (pages.length === 0) throw new Error("The PDF has no pages.");
  return pages;
}

// Render every PDF page to a raster image. One page → the image;
// multiple → a zip of page-1.<ext>, page-2.<ext>, ...
export async function pdfToImages(
  input: Buffer, output: "png" | "jpg",
): Promise<{ data: Buffer; ext: string; zip: boolean }> {
  const pngPages = await renderPdfPages(input);
  const ext = output === "jpg" ? "jpg" : "png";
  const pages: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < pngPages.length; i++) {
    const data = ext === "jpg"
      ? await sharp(pngPages[i]).jpeg({ quality: LOSSY_QUALITY }).toBuffer()
      : pngPages[i];
    pages.push({ name: `page-${i + 1}.${ext}`, data });
  }
  if (pages.length === 1) return { data: pages[0].data, ext, zip: false };
  return { data: await zipFiles(pages), ext: "zip", zip: true };
}

// Reads the uploaded file, routes by category to the right engine, and
// writes out.<ext> in the job's convert dir.
export async function convertUploaded(
  inPath: string, inputName: string, id: string, output: OutputFormat,
): Promise<{ ext: string; zip: boolean }> {
  const category = categoryForFile(inputName);
  if (category === null) throw new Error("This file type isn't supported yet.");

  if (isAudioOutput(output)) {
    if (category !== "audio") throw new Error(`Cannot convert this file to ${output}.`);
    await transcodeAudio(inPath, id, output as "mp3" | "wav" | "m4a");
    return { ext: output, zip: false };
  }

  const dir = convertDir(id);
  const input = await readFile(inPath);

  if (category === "pdf") {
    if (output !== "png" && output !== "jpg") throw new Error(`Cannot convert a PDF to ${output}.`);
    const { data, ext, zip } = await pdfToImages(input, output);
    await writeFile(resolve(dir, `out.${ext}`), data);
    return { ext, zip };
  }

  if (category === "image" || category === "heic") {
    if (output === "pdf") {
      const png = category === "heic" ? await heicToRaster(input, "png") : input;
      const data = await imageToPdf(png);
      await writeFile(resolve(dir, "out.pdf"), data);
      return { ext: "pdf", zip: false };
    }
    if (category === "heic") {
      if (output !== "png" && output !== "jpg") throw new Error(`Cannot convert this file to ${output}.`);
      const data = await heicToRaster(input, output);
      await writeFile(resolve(dir, `out.${extFor(output)}`), data);
      return { ext: extFor(output), zip: false };
    }
    if (output === "png" || output === "jpg" || output === "webp") {
      const data = await imageToRaster(input, output);
      await writeFile(resolve(dir, `out.${extFor(output)}`), data);
      return { ext: extFor(output), zip: false };
    }
  }

  throw new Error(`Cannot convert this file to ${output}.`);
}
