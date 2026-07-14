// Browser-only canvas helpers shared by the background remover and its editor.
// Kept out of the components so the compositing/export path is defined once.

export type BgFill = "transparent" | { color: string };

/** Copy the RGB image but swap in the given alpha channel. */
export function applyAlpha(rgb: ImageData, alpha: Uint8ClampedArray): ImageData {
  const out = new ImageData(new Uint8ClampedArray(rgb.data), rgb.width, rgb.height);
  for (let i = 0; i < alpha.length; i++) out.data[i * 4 + 3] = alpha[i];
  return out;
}

/** Build the final cut-out canvas: subject over transparency, or over a fill. */
export function composeCutout(rgb: ImageData, alpha: Uint8ClampedArray, fill: BgFill): HTMLCanvasElement {
  const W = rgb.width;
  const H = rgb.height;
  const cut = document.createElement("canvas");
  cut.width = W;
  cut.height = H;
  const cctx = cut.getContext("2d");
  if (!cctx) throw new Error("Canvas not supported.");
  cctx.putImageData(applyAlpha(rgb, alpha), 0, 0);
  if (fill === "transparent") return cut;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("Canvas not supported.");
  octx.fillStyle = fill.color;
  octx.fillRect(0, 0, W, H);
  octx.drawImage(cut, 0, 0);
  return out;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the image."))), "image/png"),
  );
}

/** Decode a File to full-resolution RGB pixels (alpha ignored / opaque). */
export async function decodeToRgb(file: File): Promise<{ rgb: ImageData; W: number; H: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported.");
    ctx.drawImage(bitmap, 0, 0);
    return { rgb: ctx.getImageData(0, 0, W, H), W, H };
  } finally {
    bitmap.close();
  }
}
