"use client";
import { useEffect, useRef, useState } from "react";
import { getFrame, type FrameSpec, type HeadshotStyle } from "@event-editor/core/frames";
import { DESIGNER_FONTS } from "@/lib/designer-fonts";
import { photoCrop, rimGeometry, textLines } from "@/lib/headshot-layout";

// Live, in-browser proxy of the server render. It reads the same geometry
// (headshot-layout) and the same font files as headshot-render.ts, so what you
// tune here matches the exported PNG closely. The PNG remains authoritative.

const loadedFonts = new Set<string>();

/** Loads a designer face into document.fonts under `family` at `weight` once. */
async function ensureFace(family: string, file: string, weight: number): Promise<void> {
  const key = `${family}:${weight}`;
  if (loadedFonts.has(key)) return;
  try {
    const face = new FontFace(family, `url(/fonts/designer/${file})`, { weight: String(weight) });
    await face.load();
    (document.fonts as FontFaceSet).add(face);
    loadedFonts.add(key);
  } catch {
    // A missing font just falls back to the browser default; not fatal for a preview.
  }
}

/** Family name + files to load for a card font id (absent ⇒ the DM Sans default). */
function faceFor(fontId: string | undefined): { family: string; regular: string; bold?: string } {
  if (!fontId) return { family: "EE DM Sans", regular: "dm-sans-regular.ttf", bold: "dm-sans-bold.ttf" };
  const base = DESIGNER_FONTS.find((f) => f.id === fontId);
  const bold = DESIGNER_FONTS.find((f) => f.id === `${fontId}-bold`);
  return {
    family: `EE ${fontId}`,
    regular: base?.file ?? "dm-sans-regular.ttf",
    bold: bold?.file,
  };
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
      ctx.fillStyle = ((x / s + y / s) % 2 === 0) ? "#e7e5e4" : "#f5f5f4";
      ctx.fillRect(x, y, s, s);
    }
  }
}

interface Props {
  frameId: string;
  photoUrl: string | null;
  nameText: string;
  titleText: string;
  style: HeadshotStyle;
  /** Pan changes from dragging the photo, as normalized -1..1 offsets. */
  onPan?: (offsetX: number, offsetY: number) => void;
}

export function PreviewCanvas({ frameId, photoUrl, nameText, titleText, style, onPan }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const frame = getFrame(frameId);

  // Load the photo whenever the url changes.
  useEffect(() => {
    setImgReady(false);
    if (!photoUrl) { imgRef.current = null; return; }
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgReady(true); };
    img.onerror = () => { imgRef.current = null; setImgReady(false); };
    img.src = photoUrl;
  }, [photoUrl]);

  // Redraw on any input change (and once fonts/photo settle).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;

    (async () => {
      const face = faceFor(style.fontId);
      await ensureFace(face.family, face.regular, 400);
      if (face.bold) await ensureFace(face.family, face.bold, 700);
      if (cancelled) return;
      draw(ctx, frame, imgRef.current, nameText, titleText, style, face.family);
    })();

    return () => { cancelled = true; };
  }, [frame, nameText, titleText, style, imgReady]);

  if (!frame) return null;
  const C = frame.canvas;
  const canPan = frame.photo.shape === "circle" && (style.zoom ?? 1) > 1;

  function toOffsetDelta(clientDx: number, clientDy: number) {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return { dx: 0, dy: 0 };
    const scale = C / canvas.getBoundingClientRect().width; // css px → canvas px
    const z = style.zoom ?? 1;
    const slackX = (z - 1) * frame.photo.w;
    const slackY = (z - 1) * frame.photo.h;
    // Dragging the photo right reveals its left edge ⇒ offset decreases.
    return {
      dx: slackX > 0 ? (-2 * clientDx * scale) / slackX : 0,
      dy: slackY > 0 ? (-2 * clientDy * scale) / slackY : 0,
    };
  }

  return (
    <canvas
      ref={canvasRef}
      width={C}
      height={C}
      className="w-full max-w-80 rounded-xl border border-line"
      style={{ touchAction: canPan ? "none" : undefined, cursor: canPan ? "grab" : "default" }}
      onPointerDown={(e) => {
        if (!canPan) return;
        drag.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        (e.target as HTMLElement).style.cursor = "grabbing";
      }}
      onPointerMove={(e) => {
        if (!drag.current || !onPan) return;
        const { dx, dy } = toOffsetDelta(e.clientX - drag.current.x, e.clientY - drag.current.y);
        drag.current = { x: e.clientX, y: e.clientY };
        const nx = Math.max(-1, Math.min(1, (style.offsetX ?? 0) + dx));
        const ny = Math.max(-1, Math.min(1, (style.offsetY ?? 0) + dy));
        onPan(nx, ny);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        (e.target as HTMLElement).style.cursor = "grab";
      }}
      aria-label="Headshot preview"
    />
  );
}

function draw(
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

  // Background: a checkerboard signals transparency; otherwise the frame fill.
  if (style.transparentBg) drawCheckerboard(ctx, C);
  else { ctx.fillStyle = frame.bg; ctx.fillRect(0, 0, C, C); }

  // Frame chrome behind the photo/text (band, plate, accent) for the non-circle frames.
  if (frame.plate) { ctx.fillStyle = frame.plate.fill; roundRect(ctx, frame.plate.x, frame.plate.y, frame.plate.w, frame.plate.h, frame.plate.rx); ctx.fill(); }
  if (frame.band) { ctx.fillStyle = frame.band.fill; ctx.fillRect(frame.band.x, frame.band.y, frame.band.w, frame.band.h); }
  if (frame.accent) { ctx.fillStyle = frame.accent.fill; ctx.fillRect(frame.accent.x, frame.accent.y, frame.accent.w, frame.accent.h); }

  const p = frame.photo;
  ctx.save();
  if (p.shape === "circle") {
    ctx.beginPath();
    ctx.arc(p.x + p.w / 2, p.y + p.h / 2, Math.min(p.w, p.h) / 2, 0, Math.PI * 2);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
  }
  if (img) {
    const r = sourceRect(img.naturalWidth, img.naturalHeight, p.w, p.h, style.zoom ?? 1, style.offsetX ?? 0, style.offsetY ?? 0);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, p.x, p.y, p.w, p.h);
  } else {
    ctx.fillStyle = "#d6d3d1";
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }
  ctx.restore();

  // Rim on the circle edge.
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

  // Text.
  const lines = textLines(frame, style, { name: nameText, title: titleText, company: style.companyText ?? "" });
  ctx.textBaseline = "top";
  for (const line of lines) {
    const weight = line.bold ? 700 : 400;
    const italic = line.italic ? "italic " : "";
    ctx.font = `${italic}${weight} ${line.size}px "${family}", sans-serif`;
    ctx.fillStyle = line.color;
    ctx.textAlign = line.anchor === "center" ? "center" : "left";
    // ctx.letterSpacing exists in Chromium/Electron; guard for older engines.
    try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${line.tracking}px`; } catch { /* ignore */ }
    ctx.fillText(line.text, line.x, line.yTop);
  }
  try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px"; } catch { /* ignore */ }
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
