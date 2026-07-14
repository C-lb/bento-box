export type BrushMode = "erase" | "restore";

/**
 * Paint one soft circular brush dab into an alpha buffer, in place. The buffer
 * is one byte (0-255) per pixel, row-major, length W*H — it's the cut-out's
 * alpha channel. "erase" pushes painted pixels toward 0 (removes leftover
 * background the model kept); "restore" pushes them toward 255 (brings back
 * subject the model wrongly cut). Both use a squared radial falloff so strokes
 * feather at the edge instead of leaving a hard rim, and both are monotonic
 * (erase only lowers, restore only raises) so overlapping dabs in one drag never
 * fight each other.
 */
export function applyBrush(
  alpha: Uint8ClampedArray,
  W: number,
  H: number,
  cx: number,
  cy: number,
  radius: number,
  mode: BrushMode,
): void {
  if (radius <= 0 || W <= 0 || H <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(W - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(H - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2) / radius; // 1 at centre -> 0 at edge
      const f = falloff * falloff; // soften
      const i = y * W + x;
      if (mode === "erase") {
        const target = Math.round(alpha[i] * (1 - f));
        if (target < alpha[i]) alpha[i] = target;
      } else {
        const target = Math.round(255 * f);
        if (target > alpha[i]) alpha[i] = target;
      }
    }
  }
}

/** Map a pointer position on the displayed canvas to image pixel coordinates. */
export function canvasToImage(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  imgW: number,
  imgH: number,
): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * imgW;
  const y = ((clientY - rect.top) / rect.height) * imgH;
  return { x, y };
}
