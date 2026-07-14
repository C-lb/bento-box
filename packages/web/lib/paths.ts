import { resolve } from "node:path";

export function publicUrl(): string {
  return process.env.EE_PUBLIC_URL ?? "http://localhost:3000";
}

export function thumbsDir(): string {
  return process.env.EE_THUMBS_DIR ?? "data/thumbs";
}

export function fontPath(): string {
  return process.env.EE_FONT_PATH ?? resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf");
}

/** Directory holding the bundled designer .ttf files, for server-side glyph
 *  rendering. Overridable in the packaged app where public/ lives elsewhere. */
export function designerFontDir(): string {
  return process.env.EE_FONT_DIR ?? resolve(process.cwd(), "public/fonts/designer");
}
