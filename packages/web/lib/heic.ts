import convert from "heic-convert";
import sharp from "sharp";
import { hasHeicFilters, type HeicOpts } from "@event-editor/core/heic";

export async function heicToImage(input: Buffer, opts: HeicOpts): Promise<Buffer> {
  const decoded = await convert({
    buffer: input,
    format: opts.format === "png" ? "PNG" : "JPEG",
    quality: opts.quality / 100, // heic-convert wants 0..1
  });
  const buf = Buffer.from(decoded);

  // No filters requested: hand back heic-convert's output untouched.
  if (!hasHeicFilters(opts)) return buf;

  // Apply saturation/brightness (modulate) and haze (blur), then re-encode at
  // the requested quality so the filtered pixels land in the final file.
  let pipeline = sharp(buf).modulate({ saturation: opts.saturation, brightness: opts.brightness });
  if (opts.haze > 0) pipeline = pipeline.blur(opts.haze);
  return opts.format === "png"
    ? pipeline.png().toBuffer()
    : pipeline.jpeg({ quality: opts.quality }).toBuffer();
}
