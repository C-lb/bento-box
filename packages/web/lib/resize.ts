import sharp from "sharp";
import { sharpFormat, type ResizeFormat } from "@event-editor/core/resize";

export async function resizeImage(
  input: Buffer,
  opts: { maxW: number | null; maxH: number | null; format: ResizeFormat; quality: number },
  srcName: string,
): Promise<{ data: Buffer; ext: string }> {
  let img = sharp(input, { failOn: "none" });
  if (opts.maxW || opts.maxH) {
    img = img.resize({
      width: opts.maxW ?? undefined,
      height: opts.maxH ?? undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const fmt = sharpFormat(opts.format, srcName);
  const data =
    fmt === "png"
      ? await img.png({ quality: opts.quality }).toBuffer()
      : fmt === "webp"
        ? await img.webp({ quality: opts.quality }).toBuffer()
        : await img.jpeg({ quality: opts.quality }).toBuffer();
  return { data, ext: fmt === "jpeg" ? "jpg" : fmt };
}
