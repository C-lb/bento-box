// packages/web/lib/headshot-canvas-draw.ts
//
// The browser-side draw routine for a headshot card, shared by the live
// PreviewCanvas and the preset thumbnail renderer. It reads the same
// headshot-layout geometry and the same designer font files as the server
// renderer, so the on-screen result tracks the exported PNG closely.

import type { FrameSpec, HeadshotStyle } from "@event-editor/core/frames";
import { DESIGNER_FONTS } from "./designer-fonts";
import { photoCrop, rimGeometry, textLines } from "./headshot-layout";

const loadedFonts = new Set<string>();

async function ensureFace(family: string, file: string, weight: number): Promise<void> {
  const key = `${family}:${weight}`;
  if (loadedFonts.has(key)) return;
  try {
    const face = new FontFace(family, `url(/fonts/designer/${file})`, { weight: String(weight) });
    await face.load();
    (document.fonts as FontFaceSet).add(face);
    loadedFonts.add(key);
  } catch {
    // A missing font falls back to the browser default; not fatal for a preview.
  }
}

function faceFor(fontId: string | undefined): { family: string; regular: string; bold?: string } {
  if (!fontId) return { family: "EE DM Sans", regular: "dm-sans-regular.ttf", bold: "dm-sans-bold.ttf" };
  const base = DESIGNER_FONTS.find((f) => f.id === fontId);
  const bold = DESIGNER_FONTS.find((f) => f.id === `${fontId}-bold`);
  return { family: `EE ${fontId}`, regular: base?.file ?? "dm-sans-regular.ttf", bold: bold?.file };
}

/** Loads the card font (regular + bold) and returns the family name to draw with. */
export async function loadCardFont(style: HeadshotStyle): Promise<string> {
  const face = faceFor(style.fontId);
  await ensureFace(face.family, face.regular, 400);
  if (face.bold) await ensureFace(face.family, face.bold, 700);
  return face.family;
}

// Cover-fit + zoom + pan on canvas: mirror sharp's resize(cover)+extract by
// mapping the visible slot window back to a source rectangle for drawImage.
function sourceRect(
  natW: number,
  natH: number,
  slotW: number,
  slotH: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
) {
  const crop = photoCrop(slotW, slotH, zoom, offsetX, offsetY);
  const scale = Math.max(crop.zw / natW, crop.zh / natH);
  const imgX = (crop.zw - natW * scale) / 2;
  const imgY = (crop.zh - natH * scale) / 2;
  return {
    sx: (crop.extractLeft - imgX) / scale,
    sy: (crop.extractTop - imgY) / scale,
    sw: slotW / scale,
    sh: slotH / scale,
  };
}

function drawCheckerboard(ctx: CanvasRenderingContext2D, size: number) {
  const s = 32;
  for (let y = 0; y < size; y += s) {
    for (let x = 0; x < size; x += s) {
      ctx.fillStyle = (x / s + y / s) % 2 === 0 ? "#e7e5e4" : "#f5f5f4";
      ctx.fillRect(x, y, s, s);
    }
  }
}

// A neutral head-and-shoulders silhouette for the empty state and preset
// thumbnails, so a card without a real photo still reads as a headshot.
function drawSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = "#d6d3d1";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#a8a29e";
  const cx = x + w / 2;
  const headR = w * 0.19;
  const headCy = y + h * 0.4;
  ctx.beginPath();
  ctx.arc(cx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.95, w * 0.34, h * 0.28, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the full card onto ctx at the frame's native canvas size. */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  frame: FrameSpec,
  img: HTMLImageElement | null,
  nameText: string,
  titleText: string,
  style: HeadshotStyle,
  family: string,
) {
  const C = frame.canvas;
  ctx.clearRect(0, 0, C, C);

  if (style.transparentBg) drawCheckerboard(ctx, C);
  else { ctx.fillStyle = frame.bg; ctx.fillRect(0, 0, C, C); }

  if (frame.plate) { ctx.fillStyle = frame.plate.fill; roundRect(ctx, frame.plate.x, frame.plate.y, frame.plate.w, frame.plate.h, frame.plate.rx); ctx.fill(); }
  if (frame.band) { ctx.fillStyle = frame.band.fill; ctx.fillRect(frame.band.x, frame.band.y, frame.band.w, frame.band.h); }
  if (frame.accent) { ctx.fillStyle = frame.accent.fill; ctx.fillRect(frame.accent.x, frame.accent.y, frame.accent.w, frame.accent.h); }

  const p = frame.photo;
  ctx.save();
  ctx.beginPath();
  if (p.shape === "circle") ctx.arc(p.x + p.w / 2, p.y + p.h / 2, Math.min(p.w, p.h) / 2, 0, Math.PI * 2);
  else ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();
  if (img) {
    const r = sourceRect(img.naturalWidth, img.naturalHeight, p.w, p.h, style.zoom ?? 1, style.offsetX ?? 0, style.offsetY ?? 0);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, p.x, p.y, p.w, p.h);
  } else {
    drawSilhouette(ctx, p.x, p.y, p.w, p.h);
  }
  ctx.restore();

  const rim = rimGeometry(frame, style.rim);
  if (rim) {
    ctx.beginPath();
    ctx.arc(rim.cx, rim.cy, rim.ringRadius, 0, Math.PI * 2);
    ctx.lineWidth = rim.width;
    if (rim.mode === "gradient" && rim.gradient) {
      const g = ctx.createLinearGradient(rim.gradient.x1, rim.gradient.y1, rim.gradient.x2, rim.gradient.y2);
      g.addColorStop(0, rim.from ?? "#000000");
      g.addColorStop(1, rim.to ?? "#000000");
      ctx.strokeStyle = g;
    } else {
      ctx.strokeStyle = rim.color ?? "#000000";
    }
    ctx.stroke();
  }

  const lines = textLines(frame, style, { name: nameText, title: titleText, company: style.companyText ?? "" });
  ctx.textBaseline = "top";
  for (const line of lines) {
    ctx.font = `${line.italic ? "italic " : ""}${line.bold ? 700 : 400} ${line.size}px "${family}", sans-serif`;
    ctx.fillStyle = line.color;
    ctx.textAlign = line.anchor === "center" ? "center" : "left";
    try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${line.tracking}px`; } catch { /* older engine */ }
    ctx.fillText(line.text, line.x, line.yTop);
  }
  try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px"; } catch { /* older engine */ }
}
