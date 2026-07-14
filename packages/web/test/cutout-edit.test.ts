import { describe, it, expect } from "vitest";
import { applyBrush, canvasToImage } from "@/lib/cutout-edit";

function grid(W: number, H: number, fill: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H);
  a.fill(fill);
  return a;
}

describe("applyBrush", () => {
  it("erase drives the painted centre toward 0", () => {
    const W = 21, H = 21;
    const a = grid(W, H, 255);
    applyBrush(a, W, H, 10, 10, 6, "erase");
    expect(a[10 * W + 10]).toBe(0); // centre fully erased
  });

  it("restore drives the painted centre toward 255", () => {
    const W = 21, H = 21;
    const a = grid(W, H, 0);
    applyBrush(a, W, H, 10, 10, 6, "restore");
    expect(a[10 * W + 10]).toBe(255); // centre fully restored
  });

  it("leaves pixels outside the brush radius untouched", () => {
    const W = 21, H = 21;
    const a = grid(W, H, 255);
    applyBrush(a, W, H, 10, 10, 4, "erase");
    expect(a[0]).toBe(255); // far corner unchanged
    expect(a[H * W - 1]).toBe(255);
  });

  it("feathers: a pixel near the edge changes less than the centre", () => {
    const W = 41, H = 41;
    const a = grid(W, H, 0);
    applyBrush(a, W, H, 20, 20, 12, "restore");
    const centre = a[20 * W + 20];
    const nearEdge = a[20 * W + (20 + 10)]; // 10px from centre, radius 12
    expect(centre).toBeGreaterThan(nearEdge);
    expect(nearEdge).toBeGreaterThan(0);
  });

  it("is a no-op for a non-positive radius", () => {
    const W = 5, H = 5;
    const a = grid(W, H, 128);
    applyBrush(a, W, H, 2, 2, 0, "erase");
    expect([...a].every((v) => v === 128)).toBe(true);
  });

  it("erase is monotonic — a second dab never raises alpha", () => {
    const W = 21, H = 21;
    const a = grid(W, H, 200);
    applyBrush(a, W, H, 10, 10, 8, "erase");
    const after1 = [...a];
    applyBrush(a, W, H, 10, 10, 8, "erase");
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeLessThanOrEqual(after1[i]);
  });
});

describe("canvasToImage", () => {
  it("scales a client point into image pixel space", () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 };
    const p = canvasToImage(300, 200, rect, 800, 600);
    expect(p.x).toBeCloseTo(400); // halfway across -> half of 800
    expect(p.y).toBeCloseTo(300); // halfway down -> half of 600
  });
});
