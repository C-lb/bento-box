// packages/web/test/headshot-render.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { getFrame } from "@event-editor/core/frames";
import { renderHeadshot } from "../lib/headshot-render";

async function redSquare(size = 400): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: "#cc0000" } }).png().toBuffer();
}

describe("renderHeadshot", () => {
  for (const id of ["clean-band", "circle", "minimal-corner"]) {
    it(`renders the ${id} frame to a 1080 square png`, async () => {
      const out = await renderHeadshot(await redSquare(), getFrame(id)!, "Jane Okafor", "Head of Partnerships");
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1080);
    });
  }

  it("actually draws the name text (band area is not blank where a glyph sits)", async () => {
    const out = await renderHeadshot(await redSquare(), getFrame("clean-band")!, "Jane Okafor", "Head");
    // sample the band region (charcoal bg, white glyphs). Average it; pure
    // charcoal would be ~ (28,28,30). White glyph pixels lift the mean.
    const { data, info } = await sharp(out)
      .extract({ left: 64, top: 880, width: 420, height: 70 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i += info.channels) sum += data[i]; // red channel
    const mean = sum / (data.length / info.channels);
    expect(mean).toBeGreaterThan(40); // > flat charcoal => glyphs rendered
  });
});
