import { resolve } from "node:path";
import TextToSVG from "text-to-svg";
import { DESIGNER_FONTS } from "./designer-fonts";
import { designerFontDir, fontPath } from "./paths";

// text-to-svg converts glyphs to vector paths at render time, so the raster step
// (sharp/librsvg) never has to find an installed font — that's why the headshot
// pipeline uses it. Each distinct face is loaded once and cached.

const cache = new Map<string, TextToSVG>();

function load(key: string, path: string): TextToSVG {
  let tts = cache.get(key);
  if (!tts) {
    tts = TextToSVG.loadSync(path);
    cache.set(key, tts);
  }
  return tts;
}

interface Face {
  tts: TextToSVG;
  /** True when a real bold face is in use (so we must NOT also faux-bold). */
  realBold: boolean;
}

/**
 * Resolves the face for a card font + weight.
 *  - No fontId ⇒ the legacy default (DM Sans Medium at assets/fonts). Bold there
 *    still uses the stroke-based faux bold, exactly as before.
 *  - A designer fontId ⇒ its bundled .ttf. If bold is asked and a `<id>-bold`
 *    variant exists in the registry, that real bold face is used and faux bold
 *    is suppressed; otherwise (e.g. Great Vibes) it falls back to regular +
 *    faux bold.
 */
function resolveFace(fontId: string | undefined, bold: boolean): Face {
  if (!fontId) return { tts: load("__default__", fontPath()), realBold: false };

  const entry = DESIGNER_FONTS.find((f) => f.id === fontId);
  if (!entry) return { tts: load("__default__", fontPath()), realBold: false };

  const boldEntry = bold ? DESIGNER_FONTS.find((f) => f.id === `${fontId}-bold`) : undefined;
  const use = boldEntry ?? entry;
  return {
    tts: load(use.id, resolve(designerFontDir(), use.file)),
    realBold: !!boldEntry,
  };
}

export interface GlyphOpts {
  x: number;
  y: number;
  fontSize: number;
  anchor: "left" | "center";
  color: string;
  bold?: boolean;
  italic?: boolean;
  /** Card font id from the designer registry; absent ⇒ legacy default face. */
  fontId?: string;
  /** Letter-spacing in px; 0 (default) keeps native kerning. */
  tracking?: number;
}

export function glyphPath(text: string, opts: GlyphOpts): string {
  if (!text) return "";
  const { tts, realBold } = resolveFace(opts.fontId, !!opts.bold);

  // Faux bold only when there's no real bold face: stroke the outline in the
  // same colour to thicken every stem.
  const attributes: Record<string, string> = { fill: opts.color };
  const fauxBold = opts.bold && !realBold;
  if (fauxBold) {
    attributes.stroke = opts.color;
    attributes["stroke-width"] = (opts.fontSize * 0.035).toFixed(2);
  }

  const path =
    opts.tracking && opts.tracking !== 0
      ? trackedPath(tts, text, opts.fontSize, opts.x, opts.y, opts.anchor, opts.tracking, attributes)
      : tts.getPath(text, {
          x: opts.x,
          y: opts.y,
          fontSize: opts.fontSize,
          anchor: opts.anchor === "center" ? "center top" : "left top",
          attributes,
        });

  if (!opts.italic) return path;
  // Faux italic: shear horizontally around the baseline so the slant reads as
  // italic without shifting the line off its position.
  const baseline = opts.y + opts.fontSize;
  return `<g transform="translate(0 ${baseline}) skewX(-12) translate(0 ${-baseline})">${path}</g>`;
}

// text-to-svg has no letter-spacing, so lay out each glyph at an accumulating x.
// Tracking deliberately loosens the line, so dropping native kerning here is
// expected. Total width is summed first to honour the centre anchor.
function trackedPath(
  tts: TextToSVG,
  text: string,
  fontSize: number,
  x: number,
  y: number,
  anchor: "left" | "center",
  tracking: number,
  attributes: Record<string, string>,
): string {
  const chars = [...text];
  const widths = chars.map((c) => tts.getMetrics(c, { fontSize }).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let cx = anchor === "center" ? x - total / 2 : x;
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== " ") {
      parts.push(tts.getPath(chars[i], { x: cx, y, fontSize, anchor: "left top", attributes }));
    }
    cx += widths[i] + tracking;
  }
  return parts.join("");
}
