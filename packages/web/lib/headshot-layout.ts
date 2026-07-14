// packages/web/lib/headshot-layout.ts
//
// Pure geometry shared by the server renderer (headshot-render.ts, text-to-svg
// + sharp) and the client live preview (PreviewCanvas.tsx, Chromium 2D). Keeping
// every position/size/crop number here is what stops the two renderers from
// drifting: neither computes geometry on its own. No font metrics live here —
// glyph measurement is engine-specific, so each renderer measures and centres
// its own text using the sizes/tracking this module hands it.

import type { FrameSpec, HeadshotStyle, LineStyle, RimSpec, TextLine } from "@event-editor/core/frames";

export type LineKey = "name" | "title" | "company";

/** Vertical gap a frame leaves between its name and title boxes, reused to
 *  stack the (new) company line and to re-stack when per-line sizes change. */
function frameGap(frame: FrameSpec): number {
  return Math.max(0, frame.title.y - frame.name.y - frame.name.size);
}

/** Effective style for one line: per-line field → card-level legacy field →
 *  frame default. */
export interface ResolvedLine {
  key: LineKey;
  text: string;
  x: number;
  /** Top of the text box on the frame canvas. */
  yTop: number;
  size: number;
  tracking: number;
  bold: boolean;
  italic: boolean;
  color: string;
  anchor: "left" | "center";
}

function baseLine(frame: FrameSpec, key: LineKey): TextLine {
  // Company has no frame slot; it borrows the title's x/anchor/colour/size and
  // is positioned by the stacker below.
  return key === "company" ? frame.title : frame[key];
}

function lineOverride(style: HeadshotStyle | undefined, key: LineKey): LineStyle | undefined {
  return style?.[key];
}

/**
 * Resolves and vertically stacks the visible text lines. The block is anchored
 * at the frame's name.y and each subsequent line follows by
 * `previousSize + gap`, so with default sizes name/title land exactly on their
 * frame positions (back-compat) and the company line appears just beneath the
 * title. Growing a line's size pushes the lines below it down.
 */
export function textLines(
  frame: FrameSpec,
  style: HeadshotStyle | undefined,
  texts: { name: string; title: string; company?: string },
): ResolvedLine[] {
  // lineGap adds to the frame's own inter-line gap; textOffsetY shifts the whole
  // block down from the photo. Both default to 0 ⇒ unchanged layout.
  const gap = frameGap(frame) + (style?.lineGap ?? 0);
  const uppercase = !!style?.uppercase;
  const cap = (s: string) => (uppercase ? s.toUpperCase() : s);

  const order: { key: LineKey; text: string }[] = [
    { key: "name", text: texts.name },
    { key: "title", text: texts.title },
    { key: "company", text: texts.company ?? "" },
  ];

  const out: ResolvedLine[] = [];
  let yTop = frame.name.y + (style?.textOffsetY ?? 0);
  let first = true;
  for (const { key, text } of order) {
    const base = baseLine(frame, key);
    const ov = lineOverride(style, key);
    const size = ov?.size ?? base.size;
    // The company line is optional; skip it entirely when empty, but it still
    // must not consume vertical space or a gap.
    if (key === "company" && !text) continue;

    if (!first) yTop += gap; // gap precedes every line after the first drawn one
    out.push({
      key,
      text: cap(text),
      x: base.x,
      yTop,
      size,
      tracking: ov?.tracking ?? 0,
      bold: ov?.bold ?? !!style?.bold,
      italic: ov?.italic ?? !!style?.italic,
      color: style?.color || base.color,
      anchor: base.anchor,
    });
    yTop += size;
    first = false;
  }
  return out;
}

/** Crop box for the photo slot given zoom + normalized pan. */
export interface PhotoCrop {
  /** Resized source dimensions (cover-fit at zoom). */
  zw: number;
  zh: number;
  /** Extract window (slotW × slotH) offset into the resized source. */
  extractLeft: number;
  extractTop: number;
  slotW: number;
  slotH: number;
}

function clampPan(offset: number, slack: number): number {
  if (slack <= 0) return 0; // no zoom slack ⇒ pan has nothing to move
  // offset -1..1 maps across the full slack, centred at 0.
  const px = (Math.max(-1, Math.min(1, offset)) * slack) / 2;
  const centre = slack / 2;
  return Math.max(0, Math.min(slack, centre + px));
}

export function photoCrop(
  slotW: number,
  slotH: number,
  zoom: number,
  offsetX = 0,
  offsetY = 0,
): PhotoCrop {
  const z = Math.min(3, Math.max(1, zoom || 1));
  const zw = Math.round(slotW * z);
  const zh = Math.round(slotH * z);
  return {
    zw,
    zh,
    extractLeft: Math.round(clampPan(offsetX, zw - slotW)),
    extractTop: Math.round(clampPan(offsetY, zh - slotH)),
    slotW,
    slotH,
  };
}

/** Ring geometry for the circle-frame rim. Absolute coords on the frame canvas. */
export interface RimGeometry {
  cx: number;
  cy: number;
  /** Radius of the stroked ring's centreline (photoRadius − width/2). */
  ringRadius: number;
  width: number;
  mode: "solid" | "gradient";
  color?: string;
  from?: string;
  to?: string;
  /** Gradient endpoints across the circle's bounding box, userSpace coords. */
  gradient?: { x1: number; y1: number; x2: number; y2: number };
}

/** Circle-frame rim only. Returns undefined for non-circle frames or no rim. */
export function rimGeometry(frame: FrameSpec, rim: RimSpec | undefined): RimGeometry | undefined {
  if (!rim || frame.photo.shape !== "circle") return undefined;
  const p = frame.photo;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const photoRadius = Math.min(p.w, p.h) / 2;
  const width = Math.max(2, Math.min(80, rim.width));
  const ringRadius = photoRadius - width / 2;

  let gradient: RimGeometry["gradient"];
  if (rim.mode === "gradient") {
    const rad = ((rim.angle ?? 0) * Math.PI) / 180;
    const dx = Math.cos(rad) * photoRadius;
    const dy = Math.sin(rad) * photoRadius;
    gradient = { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy };
  }
  return {
    cx,
    cy,
    ringRadius,
    width,
    mode: rim.mode,
    color: rim.color,
    from: rim.from,
    to: rim.to,
    gradient,
  };
}
