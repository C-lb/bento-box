import convert from "heic-convert";
import type { HeicFormat } from "@event-editor/core/heic";

export async function heicToImage(
  input: Buffer,
  opts: { format: HeicFormat; quality: number },
): Promise<Buffer> {
  const out = await convert({
    buffer: input,
    format: opts.format === "png" ? "PNG" : "JPEG",
    quality: opts.quality / 100, // heic-convert wants 0..1
  });
  return Buffer.from(out);
}
