import { describe, it, expect, beforeAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { computeMetrics } from "../lib/metrics.js";

const dir = tmpdir();
const sharpPath = join(dir, `ee-sharp-${Math.random().toString(36).slice(2)}.png`);
const flatPath = join(dir, `ee-flat-${Math.random().toString(36).slice(2)}.png`);

beforeAll(async () => {
  // a high-frequency checkerboard = sharp; a flat grey field = not sharp
  const size = 400;
  const checker = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = ((x >> 2) + (y >> 2)) % 2 === 0 ? 255 : 0;
      const i = (y * size + x) * 3;
      checker[i] = checker[i + 1] = checker[i + 2] = on;
    }
  }
  await sharp(checker, { raw: { width: size, height: size, channels: 3 } }).png().toFile(sharpPath);
  await sharp({ create: { width: size, height: size, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toFile(flatPath);
});

describe("computeMetrics", () => {
  it("reports dimensions and aspect ratio", async () => {
    const m = await computeMetrics(sharpPath);
    expect(m.width).toBe(400);
    expect(m.height).toBe(400);
    expect(m.aspectRatio).toBeCloseTo(1, 2);
  });
  it("scores a busy image sharper than a flat one", async () => {
    const sharpM = await computeMetrics(sharpPath);
    const flatM = await computeMetrics(flatPath);
    expect(sharpM.sharpness).toBeGreaterThan(flatM.sharpness);
    expect(flatM.brightness).toBeGreaterThan(100);
    expect(flatM.brightness).toBeLessThan(160);
  });
});
