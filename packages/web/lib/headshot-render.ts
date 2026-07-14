// packages/web/lib/headshot-render.ts
import sharp from "sharp";
import type { FrameSpec, HeadshotStyle } from "@event-editor/core/frames";
import { glyphPath } from "./text-render";
import { photoCrop, rimGeometry, textLines, type ResolvedLine, type RimGeometry } from "./headshot-layout";

function lineSvg(line: ResolvedLine, fontId?: string): string {
  return glyphPath(line.text, {
    x: line.x,
    y: line.yTop,
    fontSize: line.size,
    anchor: line.anchor,
    color: line.color,
    bold: line.bold,
    italic: line.italic,
    fontId,
    tracking: line.tracking,
  });
}

function rimSvg(g: RimGeometry): { defs: string; part: string } {
  const common = `cx="${g.cx}" cy="${g.cy}" r="${g.ringRadius}" fill="none" stroke-width="${g.width}"`;
  if (g.mode === "gradient" && g.gradient) {
    const id = "rimGrad";
    const defs =
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${g.gradient.x1}" y1="${g.gradient.y1}" x2="${g.gradient.x2}" y2="${g.gradient.y2}">` +
      `<stop offset="0" stop-color="${g.from ?? "#000000"}"/>` +
      `<stop offset="1" stop-color="${g.to ?? "#000000"}"/></linearGradient>`;
    return { defs, part: `<circle ${common} stroke="url(#${id})"/>` };
  }
  return { defs: "", part: `<circle ${common} stroke="${g.color ?? "#000000"}"/>` };
}

function buildOverlaySvg(frame: FrameSpec, nameText: string, titleText: string, style?: HeadshotStyle): string {
  const C = frame.canvas;
  const defs: string[] = [];
  const parts: string[] = [];

  if (frame.plate) {
    const p = frame.plate;
    defs.push(
      `<filter id="plateShadow" x="-20%" y="-20%" width="140%" height="140%">` +
        `<feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000000" flood-opacity="0.18"/></filter>`,
    );
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}" fill="${p.fill}" filter="url(#plateShadow)"/>`,
    );
  }
  if (frame.band) {
    const b = frame.band;
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${b.fill}"/>`);
  }
  if (frame.accent) {
    const a = frame.accent;
    parts.push(`<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" fill="${a.fill}"/>`);
  }

  // Rim sits on the circle's edge, drawn over the composited photo.
  const rim = rimGeometry(frame, style?.rim);
  if (rim) {
    const r = rimSvg(rim);
    if (r.defs) defs.push(r.defs);
    parts.push(r.part);
  }

  const lines = textLines(frame, style, {
    name: nameText,
    title: titleText,
    company: style?.companyText ?? "",
  });
  for (const line of lines) parts.push(lineSvg(line, style?.fontId));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
}

export async function renderHeadshot(
  photo: Buffer,
  frame: FrameSpec,
  nameText: string,
  titleText: string,
  style?: HeadshotStyle,
): Promise<Buffer> {
  const C = frame.canvas;
  const layers: sharp.OverlayOptions[] = [];

  // Zoom + pan via the shared layout helper: resize the source larger, then
  // extract the frame-sized window at the (clamped) pan offset.
  const crop = photoCrop(frame.photo.w, frame.photo.h, style?.zoom ?? 1, style?.offsetX ?? 0, style?.offsetY ?? 0);
  let photoLayer = sharp(photo).resize(crop.zw, crop.zh, { fit: "cover", position: "centre" });
  if (crop.zw !== frame.photo.w || crop.zh !== frame.photo.h) {
    photoLayer = photoLayer.extract({
      left: crop.extractLeft,
      top: crop.extractTop,
      width: frame.photo.w,
      height: frame.photo.h,
    });
  }
  if (frame.photo.shape === "circle") {
    const r = Math.min(frame.photo.w, frame.photo.h) / 2;
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.photo.w}" height="${frame.photo.h}">` +
        `<circle cx="${frame.photo.w / 2}" cy="${frame.photo.h / 2}" r="${r}" fill="#fff"/></svg>`,
    );
    photoLayer = photoLayer.composite([{ input: mask, blend: "dest-in" }]);
  }
  const photoBuf = await photoLayer.png().toBuffer();
  layers.push({ input: photoBuf, left: frame.photo.x, top: frame.photo.y });
  layers.push({ input: Buffer.from(buildOverlaySvg(frame, nameText, titleText, style)), left: 0, top: 0 });

  const background = style?.transparentBg ? { r: 0, g: 0, b: 0, alpha: 0 } : frame.bg;
  return sharp({ create: { width: C, height: C, channels: 4, background } })
    .composite(layers)
    .png()
    .toBuffer();
}
