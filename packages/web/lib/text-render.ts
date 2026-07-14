import TextToSVG from "text-to-svg";
import { fontPath } from "./paths";

// Load once. fontPath() defaults to the cwd-relative ttf for dev and is an
// absolute bundle path in the packaged app.
const tts = TextToSVG.loadSync(fontPath());

export function glyphPath(
  text: string,
  opts: {
    x: number;
    y: number;
    fontSize: number;
    anchor: "left" | "center";
    color: string;
    bold?: boolean;
    italic?: boolean;
  },
): string {
  if (!text) return "";
  // Faux bold: stroke the outline in the same colour to thicken every stem, so
  // we don't have to bundle a separate bold font file.
  const attributes: Record<string, string> = { fill: opts.color };
  if (opts.bold) {
    attributes.stroke = opts.color;
    attributes["stroke-width"] = (opts.fontSize * 0.035).toFixed(2);
  }
  const path = tts.getPath(text, {
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
