import TextToSVG from "text-to-svg";
import { fontPath } from "./paths";

// Load once. fontPath() defaults to the cwd-relative ttf for dev and is an
// absolute bundle path in the packaged app.
const tts = TextToSVG.loadSync(fontPath());

export function glyphPath(
  text: string,
  opts: { x: number; y: number; fontSize: number; anchor: "left" | "center"; color: string },
): string {
  if (!text) return "";
  return tts.getPath(text, {
    x: opts.x,
    y: opts.y,
    fontSize: opts.fontSize,
    anchor: opts.anchor === "center" ? "center top" : "left top",
    attributes: { fill: opts.color },
  });
}
