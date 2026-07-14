import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { FRAMES } from "@event-editor/core/frames";
import type { HeadshotStyle } from "@event-editor/core/frames";
import { renderHeadshot } from "./headshot-render";

// A plain photo buffer to feed the renderer.
async function samplePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 800, channels: 3, background: "#3366aa" } })
    .png()
    .toBuffer();
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

describe("renderHeadshot", () => {
  it("renders a circle card at the frame canvas size", async () => {
    const png = await renderHeadshot(await samplePhoto(), FRAMES.circle, "David Chin", "CEO");
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(FRAMES.circle.canvas);
    expect(meta.height).toBe(FRAMES.circle.canvas);
  });

  it("keeps the frame background opaque by default", async () => {
    const png = await renderHeadshot(await samplePhoto(), FRAMES.circle, "D", "C");
    // Top-left corner is outside the circle → shows the frame bg, fully opaque.
    expect((await pixel(png, 4, 4)).a).toBe(255);
  });

  it("makes the corners transparent when transparentBg is set", async () => {
    const style: HeadshotStyle = { transparentBg: true };
    const png = await renderHeadshot(await samplePhoto(), FRAMES.circle, "D", "C", style);
    expect((await pixel(png, 4, 4)).a).toBe(0);
  });

  it("draws a gradient rim on the circle (edge pixel no longer bg)", async () => {
    const plain = await renderHeadshot(await samplePhoto(), FRAMES.circle, "D", "C");
    const rimmed = await renderHeadshot(await samplePhoto(), FRAMES.circle, "D", "C", {
      rim: { mode: "gradient", width: 24, from: "#ff00ff", to: "#7c3aed", angle: 45 },
    });
    // Just outside the photo radius, on the ring: plain shows the light frame bg,
    // rimmed shows saturated magenta/purple — so the two differ there.
    const p = FRAMES.circle.photo;
    const x = Math.round(p.x + p.w / 2);
    const y = Math.round(p.y); // top of the circle, on the ring
    const a = await pixel(plain, x, y);
    const b = await pixel(rimmed, x, y);
    expect(b.r + b.g + b.b).not.toBe(a.r + a.g + a.b);
    expect(b.b).toBeGreaterThan(80); // purple/magenta both carry blue
  });

  it("renders a third company line without throwing", async () => {
    const style: HeadshotStyle = { companyText: "SPARK", company: { bold: true } };
    const png = await renderHeadshot(await samplePhoto(), FRAMES.circle, "David Chin", "Chief Executive Officer,", style);
    expect(png.length).toBeGreaterThan(1000);
  });

  it("renders with a designer font + per-line tracking and real bold", async () => {
    const style: HeadshotStyle = {
      fontId: "inter",
      name: { bold: true, tracking: 2 },
      title: { size: 34 },
    };
    const png = await renderHeadshot(await samplePhoto(), FRAMES.circle, "David Chin", "CEO", style);
    expect(png.length).toBeGreaterThan(1000);
    expect((await sharp(png).metadata()).width).toBe(FRAMES.circle.canvas);
  });

  it("pans the photo without changing canvas size", async () => {
    const style: HeadshotStyle = { zoom: 2, offsetX: -1, offsetY: 1 };
    const png = await renderHeadshot(await samplePhoto(), FRAMES.circle, "D", "C", style);
    expect((await sharp(png).metadata()).width).toBe(FRAMES.circle.canvas);
  });
});
