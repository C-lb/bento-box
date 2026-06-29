// packages/web/lib/headshot-render.ts
import sharp from "sharp";
import type { FrameSpec, TextLine } from "@event-editor/core/frames";
import { glyphPath } from "./text-render";

function textSvg(line: TextLine, text: string): string {
  // text-to-svg anchors at the box top; nudge baseline to roughly center the cap height.
  return glyphPath(text, {
    x: line.x,
    y: line.y,
    fontSize: line.size,
    anchor: line.anchor,
    color: line.color,
  });
}

function buildOverlaySvg(frame: FrameSpec, nameText: string, titleText: string): string {
  const C = frame.canvas;
  const parts: string[] = [];
  if (frame.plate) {
    const p = frame.plate;
    parts.push(
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
  parts.push(textSvg(frame.name, nameText));
  parts.push(textSvg(frame.title, titleText));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}"><defs></defs>${parts.join("")}</svg>`;
}

export async function renderHeadshot(
  photo: Buffer,
  frame: FrameSpec,
  nameText: string,
  titleText: string,
): Promise<Buffer> {
  const C = frame.canvas;
  const layers: sharp.OverlayOptions[] = [];

  let photoLayer = sharp(photo).resize(frame.photo.w, frame.photo.h, { fit: "cover", position: "centre" });
  if (frame.photo.shape === "circle") {
    const r = Math.min(frame.photo.w, frame.photo.h) / 2;
    const mask = Buffer.from(
      `<svg width="${frame.photo.w}" height="${frame.photo.h}">` +
        `<circle cx="${frame.photo.w / 2}" cy="${frame.photo.h / 2}" r="${r}" fill="#fff"/></svg>`,
    );
    photoLayer = photoLayer.composite([{ input: mask, blend: "dest-in" }]);
  }
  const photoBuf = await photoLayer.png().toBuffer();
  layers.push({ input: photoBuf, left: frame.photo.x, top: frame.photo.y });
  layers.push({ input: Buffer.from(buildOverlaySvg(frame, nameText, titleText)), left: 0, top: 0 });

  return sharp({ create: { width: C, height: C, channels: 4, background: frame.bg } })
    .composite(layers)
    .png()
    .toBuffer();
}
