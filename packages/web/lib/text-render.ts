import { resolve } from "node:path";
import TextToSVG from "text-to-svg";

// cwd is packages/web at runtime (Next) and under vitest. Load once.
const tts = TextToSVG.loadSync(resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf"));

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
