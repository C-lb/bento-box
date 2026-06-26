import sharp from "sharp";
import type { ImageMetrics } from "@event-editor/core/rank";

export async function computeMetrics(filePath: string): Promise<ImageMetrics> {
  const meta = await sharp(filePath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // Downscale to a small greyscale raster for cheap, stable metrics.
  const side = 64;
  const { data } = await sharp(filePath)
    .grayscale()
    .resize(side, side, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const brightness = sum / data.length;

  // Edge-energy: variance of horizontal+vertical neighbour differences.
  let diffSum = 0;
  let diffSqSum = 0;
  let n = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const idx = y * side + x;
      if (x + 1 < side) {
        const d = Math.abs(data[idx] - data[idx + 1]);
        diffSum += d; diffSqSum += d * d; n++;
      }
      if (y + 1 < side) {
        const d = Math.abs(data[idx] - data[idx + side]);
        diffSum += d; diffSqSum += d * d; n++;
      }
    }
  }
  const mean = n ? diffSum / n : 0;
  const sharpness = n ? diffSqSum / n - mean * mean : 0;

  return {
    width,
    height,
    sharpness,
    brightness,
    aspectRatio: height ? width / height : 0,
  };
}
